//! Vendor-neutral GPU provider backed by `sysinfo::Gpus`.

use sysinfo::Gpus;

use super::{GpuProvider, GpuSample};
use crate::memory::percent;
use crate::reading::Reading;

const NO_TEMPERATURE: &str =
    "GPU temperature is not exposed by the generic GPU interface; it needs a vendor-specific provider";

pub struct SysinfoGpuProvider {
    gpus: Gpus,
    refreshes: u32,
}

/// Raw values for one adapter, decoupled from `sysinfo` for testing.
#[derive(Debug, Clone)]
pub struct RawGpu {
    pub id: String,
    pub model: Option<String>,
    pub vendor: Option<String>,
    pub usage: Option<f32>,
    pub memory_total: Option<u64>,
    pub memory_used: Option<u64>,
}

fn non_empty(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Converts raw values. `primed` is false on the first refresh, when
/// time-diff based usage cannot exist yet.
pub fn build(raw: RawGpu, primed: bool) -> GpuSample {
    let usage_percent = match raw.usage {
        Some(u) if u.is_finite() => Reading::ok(u.clamp(0.0, 100.0)),
        _ if !primed => Reading::Pending,
        _ => Reading::unsupported("utilisation is not reported for this GPU"),
    };
    let not_reported = || Reading::unsupported("dedicated VRAM is not reported for this GPU");
    let (memory_total_bytes, memory_used_bytes, memory_usage_percent) =
        match (raw.memory_total.filter(|&t| t > 0), raw.memory_used) {
            (Some(total), Some(used)) => (
                Reading::ok(total),
                Reading::ok(used.min(total)),
                percent(used, total),
            ),
            (Some(total), None) => (Reading::ok(total), not_reported(), None),
            _ => (not_reported(), not_reported(), None),
        };
    GpuSample {
        id: raw.id,
        model: raw.model,
        vendor: raw.vendor,
        provider: "sysinfo",
        usage_percent,
        memory_total_bytes,
        memory_used_bytes,
        memory_usage_percent,
        temperature_celsius: Reading::unsupported(NO_TEMPERATURE),
    }
}

impl SysinfoGpuProvider {
    /// Fails with an explicit `Reading` if the platform has no GPU support.
    pub fn new() -> Result<Self, Reading<Vec<GpuSample>>> {
        match Gpus::new_with_refreshed_list() {
            Ok(gpus) => Ok(Self { gpus, refreshes: 0 }),
            Err(e) => Err(Reading::from_sysinfo(Err(e), "GPU information")),
        }
    }
}

impl GpuProvider for SysinfoGpuProvider {
    fn name(&self) -> &'static str {
        "sysinfo"
    }

    fn sample(&mut self) -> Result<Vec<GpuSample>, String> {
        self.gpus.refresh(true);
        self.refreshes = self.refreshes.saturating_add(1);
        let primed = self.refreshes >= 2;
        Ok(self
            .gpus
            .iter()
            .enumerate()
            .map(|(i, g)| {
                build(
                    RawGpu {
                        // PCI address is unique per adapter; the index guards
                        // against platforms that report an empty address.
                        id: format!("{}#{i}", g.pci()),
                        model: non_empty(g.model()),
                        vendor: non_empty(g.vendor()),
                        usage: g.usage(),
                        memory_total: g.total_memory(),
                        memory_used: g.used_memory(),
                    },
                    primed,
                )
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw() -> RawGpu {
        RawGpu {
            id: "0".into(),
            model: Some("Test GPU".into()),
            vendor: Some("Vendor".into()),
            usage: Some(42.0),
            memory_total: Some(2_000),
            memory_used: Some(500),
        }
    }

    #[test]
    fn full_reading() {
        let g = build(raw(), true);
        assert_eq!(g.usage_percent, Reading::ok(42.0));
        assert_eq!(g.memory_used_bytes, Reading::ok(500));
        assert_eq!(g.memory_usage_percent, Some(25.0));
        assert!(matches!(g.temperature_celsius, Reading::Unsupported { .. }));
    }

    #[test]
    fn missing_usage_is_pending_first_then_unsupported() {
        let r = RawGpu {
            usage: None,
            ..raw()
        };
        assert_eq!(build(r.clone(), false).usage_percent, Reading::Pending);
        assert!(matches!(
            build(r, true).usage_percent,
            Reading::Unsupported { .. }
        ));
    }

    #[test]
    fn missing_or_zero_vram_is_unsupported() {
        let g = build(
            RawGpu {
                memory_total: Some(0),
                memory_used: Some(0),
                ..raw()
            },
            true,
        );
        assert!(matches!(g.memory_total_bytes, Reading::Unsupported { .. }));
        assert_eq!(g.memory_usage_percent, None);
    }
}
