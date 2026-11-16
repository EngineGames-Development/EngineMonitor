//! CPU metrics: static description and per-tick utilisation/frequency.
//!
//! `sysinfo` computes usage from the difference between two refreshes, so the
//! very first sample after start-up carries no meaningful usage. The collector
//! reports `None` for that tick instead of the misleading `0 %`.

use serde::Serialize;
use sysinfo::{LoadAvg, System};

use crate::reading::Reading;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    /// Marketing name, e.g. "AMD Ryzen 7 7800X3D 8-Core Processor".
    pub brand: Option<String>,
    pub vendor: Option<String>,
    pub architecture: String,
    pub logical_cores: usize,
    /// `None` when the OS does not report physical cores.
    pub physical_cores: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreSample {
    pub usage_percent: Option<f32>,
    pub frequency_mhz: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuSample {
    /// Overall utilisation, 0–100. `None` on the first (unprimed) tick.
    pub usage_percent: Option<f32>,
    pub cores: Vec<CoreSample>,
    /// Mean of the cores that report a frequency.
    pub frequency_mhz: Option<u64>,
    pub load_average: Reading<LoadAverage>,
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_owned())
}

/// `sysinfo` reports 0 MHz when the frequency is unknown.
fn frequency(mhz: u64) -> Option<u64> {
    (mhz > 0).then_some(mhz)
}

fn clamp_usage(v: f32) -> Option<f32> {
    v.is_finite().then(|| v.clamp(0.0, 100.0))
}

pub fn cpu_info(sys: &System) -> CpuInfo {
    let first = sys.cpus().first();
    CpuInfo {
        brand: first.and_then(|c| non_empty(c.brand())),
        vendor: first.and_then(|c| non_empty(c.vendor_id())),
        architecture: System::cpu_arch(),
        logical_cores: sys.cpus().len(),
        physical_cores: System::physical_core_count().ok().filter(|&n| n > 0),
    }
}

/// Pure assembly of a sample from raw readings; unit-testable without `sysinfo`.
pub fn build_sample(
    primed: bool,
    global_usage: f32,
    cores: impl IntoIterator<Item = (f32, u64)>,
    load: Result<LoadAvg, sysinfo::Error>,
) -> CpuSample {
    let cores: Vec<CoreSample> = cores
        .into_iter()
        .map(|(usage, mhz)| CoreSample {
            usage_percent: if primed { clamp_usage(usage) } else { None },
            frequency_mhz: frequency(mhz),
        })
        .collect();

    let freqs: Vec<u64> = cores.iter().filter_map(|c| c.frequency_mhz).collect();
    let frequency_mhz = (!freqs.is_empty()).then(|| freqs.iter().sum::<u64>() / freqs.len() as u64);

    CpuSample {
        usage_percent: if primed {
            clamp_usage(global_usage)
        } else {
            None
        },
        cores,
        frequency_mhz,
        load_average: Reading::from_sysinfo(load, "load average").map(|l| LoadAverage {
            one: l.one,
            five: l.five,
            fifteen: l.fifteen,
        }),
    }
}

/// Tracks whether usage deltas are meaningful yet.
#[derive(Debug, Default)]
pub struct CpuCollector {
    refreshes: u32,
}

impl CpuCollector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Call after `System::refresh_cpu_specifics`. Usage is valid from the
    /// second refresh onwards.
    pub fn sample(&mut self, sys: &System) -> CpuSample {
        self.refreshes = self.refreshes.saturating_add(1);
        build_sample(
            self.refreshes >= 2,
            sys.global_cpu_usage(),
            sys.cpus().iter().map(|c| (c.usage(), c.frequency())),
            System::load_average(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_ok() -> Result<LoadAvg, sysinfo::Error> {
        Ok(LoadAvg {
            one: 1.0,
            five: 0.5,
            fifteen: 0.25,
        })
    }

    #[test]
    fn unprimed_sample_reports_no_usage() {
        let s = build_sample(false, 0.0, [(0.0, 3000), (0.0, 3000)], load_ok());
        assert_eq!(s.usage_percent, None);
        assert!(s.cores.iter().all(|c| c.usage_percent.is_none()));
        // Frequency does not depend on deltas and is still reported.
        assert_eq!(s.frequency_mhz, Some(3000));
    }

    #[test]
    fn primed_sample_clamps_and_averages() {
        let s = build_sample(
            true,
            42.5,
            [(100.4, 4000), (-0.1, 2000), (f32::NAN, 0)],
            load_ok(),
        );
        assert_eq!(s.usage_percent, Some(42.5));
        assert_eq!(s.cores[0].usage_percent, Some(100.0));
        assert_eq!(s.cores[1].usage_percent, Some(0.0));
        assert_eq!(s.cores[2].usage_percent, None);
        // Core 3 reports 0 MHz = unknown, so it is excluded from the mean.
        assert_eq!(s.cores[2].frequency_mhz, None);
        assert_eq!(s.frequency_mhz, Some(3000));
    }

    #[test]
    fn missing_frequency_everywhere_is_none() {
        let s = build_sample(true, 1.0, [(1.0, 0)], load_ok());
        assert_eq!(s.frequency_mhz, None);
    }

    #[test]
    fn load_average_unsupported_is_explicit() {
        let s = build_sample(true, 1.0, [], Err(sysinfo::Error::Unsupported));
        assert!(matches!(s.load_average, Reading::Unsupported { .. }));
        let s = build_sample(true, 1.0, [], load_ok());
        assert_eq!(s.load_average.value().unwrap().five, 0.5);
    }

    #[test]
    fn collector_primes_after_second_refresh() {
        let sys = System::new().expect("System::new");
        let mut c = CpuCollector::new();
        assert!(c.sample(&sys).usage_percent.is_none());
        // Second call is primed (value may legitimately be 0 on an empty CPU list).
        let s = c.sample(&sys);
        assert_eq!(s.cores.len(), sys.cpus().len());
    }
}
