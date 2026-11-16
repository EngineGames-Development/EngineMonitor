//! Turns live ticks into history records.
//!
//! Every live snapshot is added; when the recording window has elapsed, the
//! *mean* of each metric over the window becomes one row (plus the CPU
//! maximum, so short spikes are not averaged away entirely). Values that were
//! not measured (`None`) are skipped, and a metric with no measurement in the
//! whole window is stored as NULL, never as 0.

use crate::history::store::{HistoryRecord, VolumeRecord};
use crate::reading::Reading;
use crate::system::Snapshot;

/// Volume capacity changes slowly; one row per volume per minute is enough.
pub const VOLUME_INTERVAL_MS: i64 = 60_000;

#[derive(Debug, Default, Clone, Copy)]
struct Mean {
    sum: f64,
    n: u32,
}

impl Mean {
    fn add(&mut self, v: Option<f64>) {
        if let Some(v) = v.filter(|v| v.is_finite()) {
            self.sum += v;
            self.n += 1;
        }
    }
    fn get(&self) -> Option<f64> {
        (self.n > 0).then(|| self.sum / f64::from(self.n))
    }
}

#[derive(Debug, Default)]
pub struct Accumulator {
    window_start_ms: Option<i64>,
    cpu: Mean,
    cpu_max: Option<f64>,
    memory: Mean,
    memory_used: Mean,
    swap: Mean,
    net_rx: Mean,
    net_tx: Mean,
    disk_read: Mean,
    disk_write: Mean,
    gpu: Mean,
    last_volume_ms: Option<i64>,
}

fn sum_known(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    values
        .flatten()
        .fold(None, |acc, v| Some(acc.unwrap_or(0.0) + v))
}

impl Accumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Discards the current window (e.g. after recording was re-enabled).
    pub fn reset(&mut self) {
        *self = Self {
            last_volume_ms: self.last_volume_ms,
            ..Self::default()
        };
    }

    pub fn add(&mut self, s: &Snapshot) {
        let ts = s.timestamp_ms as i64;
        self.window_start_ms.get_or_insert(ts);

        let cpu = s.cpu.usage_percent.map(f64::from);
        self.cpu.add(cpu);
        if let Some(c) = cpu {
            self.cpu_max = Some(self.cpu_max.map_or(c, |m| m.max(c)));
        }
        self.memory.add(s.memory.usage_percent);
        self.memory_used.add(Some(s.memory.used_bytes as f64));
        self.swap.add(s.memory.swap_usage_percent);
        self.net_rx.add(s.network.receive_bytes_per_sec);
        self.net_tx.add(s.network.transmit_bytes_per_sec);

        let io = s.storage.iter().filter_map(|v| v.io.value());
        let io: Vec<_> = io.collect();
        self.disk_read
            .add(sum_known(io.iter().map(|d| d.read_bytes_per_sec)));
        self.disk_write
            .add(sum_known(io.iter().map(|d| d.write_bytes_per_sec)));

        if let Reading::Ok { value: gpus } = &s.gpu {
            let busiest = gpus
                .iter()
                .filter_map(|g| g.usage_percent.value().copied())
                .fold(None::<f32>, |m, u| Some(m.map_or(u, |m| m.max(u))));
            self.gpu.add(busiest.map(f64::from));
        }
    }

    /// If at least `interval_ms` has passed since the window started, returns
    /// the window's record (timestamped `now_ms`) and starts a new window.
    pub fn take_if_due(&mut self, now_ms: i64, interval_ms: i64) -> Option<HistoryRecord> {
        let start = self.window_start_ms?;
        if now_ms - start < interval_ms {
            return None;
        }
        let record = HistoryRecord {
            ts_ms: now_ms,
            cpu: self.cpu.get(),
            cpu_max: self.cpu_max,
            memory: self.memory.get(),
            memory_used: self.memory_used.get().map(|v| v.round() as i64),
            swap: self.swap.get(),
            net_rx: self.net_rx.get(),
            net_tx: self.net_tx.get(),
            disk_read: self.disk_read.get(),
            disk_write: self.disk_write.get(),
            gpu: self.gpu.get(),
        };
        let last_volume_ms = self.last_volume_ms;
        *self = Self {
            window_start_ms: Some(now_ms),
            last_volume_ms,
            ..Self::default()
        };
        Some(record)
    }

    /// Volume capacity rows, at most once per [`VOLUME_INTERVAL_MS`].
    pub fn volumes_if_due(&mut self, s: &Snapshot) -> Vec<VolumeRecord> {
        let ts = s.timestamp_ms as i64;
        if self
            .last_volume_ms
            .is_some_and(|last| ts - last < VOLUME_INTERVAL_MS)
        {
            return Vec::new();
        }
        self.last_volume_ms = Some(ts);
        s.storage
            .iter()
            .filter(|v| v.total_bytes > 0)
            .map(|v| VolumeRecord {
                ts_ms: ts,
                mount_point: v.mount_point.clone(),
                used_bytes: v.used_bytes as i64,
                total_bytes: v.total_bytes as i64,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cpu::CpuSample;
    use crate::memory;
    use crate::network::NetworkSample;

    fn snap(ts: u64, cpu: Option<f32>, rx: Option<f64>) -> Snapshot {
        Snapshot {
            timestamp_ms: ts,
            uptime_secs: Some(1),
            cpu: CpuSample {
                usage_percent: cpu,
                cores: vec![],
                frequency_mhz: None,
                load_average: Reading::unsupported("test"),
            },
            memory: memory::build_sample(100, 40, 60, 0, 0),
            storage: vec![],
            network: NetworkSample {
                receive_bytes_per_sec: rx,
                transmit_bytes_per_sec: None,
                interfaces: vec![],
            },
            gpu: Reading::unsupported("test"),
        }
    }

    #[test]
    fn averages_window_and_tracks_cpu_max() {
        let mut a = Accumulator::new();
        a.add(&snap(1_000, Some(10.0), Some(100.0)));
        a.add(&snap(2_000, Some(50.0), None));
        a.add(&snap(3_000, None, Some(300.0)));
        assert!(a.take_if_due(3_000, 5_000).is_none(), "window not over yet");
        let r = a.take_if_due(6_000, 5_000).expect("due");
        assert_eq!(r.ts_ms, 6_000);
        assert_eq!(r.cpu, Some(30.0)); // None tick skipped
        assert_eq!(r.cpu_max, Some(50.0));
        assert_eq!(r.net_rx, Some(200.0));
        assert_eq!(r.memory, Some(40.0));
        assert_eq!(r.memory_used, Some(40));
        assert_eq!(r.swap, None, "no swap configured stays NULL");
        assert_eq!(r.gpu, None, "unsupported GPU stays NULL");
        assert_eq!(r.net_tx, None, "never measured stays NULL");
    }

    #[test]
    fn next_window_starts_fresh() {
        let mut a = Accumulator::new();
        a.add(&snap(0, Some(90.0), None));
        a.take_if_due(5_000, 5_000).unwrap();
        a.add(&snap(6_000, Some(10.0), None));
        let r = a.take_if_due(10_000, 5_000).unwrap();
        assert_eq!(r.cpu, Some(10.0));
        assert_eq!(r.cpu_max, Some(10.0));
    }

    #[test]
    fn nothing_due_before_first_sample() {
        let mut a = Accumulator::new();
        assert!(a.take_if_due(1_000_000, 1).is_none());
    }

    #[test]
    fn volumes_recorded_once_per_minute() {
        let mut a = Accumulator::new();
        let mut s = snap(0, None, None);
        s.storage = vec![crate::storage::VolumeSample {
            id: "C:\\".into(),
            name: String::new(),
            mount_point: "C:\\".into(),
            file_system: "NTFS".into(),
            kind: crate::storage::MediaKind::Ssd,
            removable: false,
            read_only: false,
            total_bytes: 100,
            available_bytes: 25,
            used_bytes: 75,
            usage_percent: Some(75.0),
            io: Reading::unsupported("t"),
        }];
        assert_eq!(a.volumes_if_due(&s).len(), 1);
        s.timestamp_ms = 30_000;
        assert!(a.volumes_if_due(&s).is_empty());
        s.timestamp_ms = 60_000;
        assert_eq!(a.volumes_if_due(&s)[0].used_bytes, 75);
    }
}
