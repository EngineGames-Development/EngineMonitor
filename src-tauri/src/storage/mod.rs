//! Mounted volumes: capacity plus read/write activity where the OS exposes it.
//!
//! Disk I/O comes from cumulative per-volume byte counters (`Disk::usage`). On
//! Windows these come from `IOCTL_DISK_PERFORMANCE`, which can be refused for
//! some volumes; `sysinfo` then leaves the counters at 0. A volume whose
//! cumulative counters have never been non-zero is therefore reported as
//! "I/O unavailable" rather than as an idle disk.

use std::collections::HashSet;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{DiskKind, Disks};

use crate::memory::percent;
use crate::rate::RateMap;
use crate::reading::Reading;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Ssd,
    Hdd,
    Unknown,
}

impl From<DiskKind> for MediaKind {
    fn from(k: DiskKind) -> Self {
        match k {
            DiskKind::SSD => MediaKind::Ssd,
            DiskKind::HDD => MediaKind::Hdd,
            _ => MediaKind::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskIo {
    /// `None` on the first tick or after a counter reset.
    pub read_bytes_per_sec: Option<f64>,
    pub write_bytes_per_sec: Option<f64>,
    pub total_read_bytes: u64,
    pub total_written_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeSample {
    /// Stable key for the UI: the mount point.
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub kind: MediaKind,
    pub removable: bool,
    pub read_only: bool,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: Option<f64>,
    pub io: Reading<DiskIo>,
}

/// Raw per-volume readings, decoupled from `sysinfo` for testing.
#[derive(Debug, Clone)]
pub struct RawVolume {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub kind: MediaKind,
    pub removable: bool,
    pub read_only: bool,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub total_read_bytes: u64,
    pub total_written_bytes: u64,
}

#[derive(Debug, Default)]
pub struct StorageCollector {
    reads: RateMap<String>,
    writes: RateMap<String>,
}

impl StorageCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn build(&mut self, volumes: Vec<RawVolume>, now: Instant) -> Vec<VolumeSample> {
        let mut seen = HashSet::with_capacity(volumes.len());
        let mut out: Vec<VolumeSample> = volumes
            .into_iter()
            .map(|v| {
                let id = v.mount_point.clone();
                seen.insert(id.clone());
                let io = if v.total_read_bytes == 0 && v.total_written_bytes == 0 {
                    // Make sure a later valid reading does not compute a rate
                    // against a bogus zero.
                    self.reads.retain(|k| k != &id);
                    self.writes.retain(|k| k != &id);
                    Reading::unsupported(
                        "the operating system does not report I/O counters for this volume",
                    )
                } else {
                    Reading::ok(DiskIo {
                        read_bytes_per_sec: self.reads.update(&id, v.total_read_bytes, now),
                        write_bytes_per_sec: self.writes.update(&id, v.total_written_bytes, now),
                        total_read_bytes: v.total_read_bytes,
                        total_written_bytes: v.total_written_bytes,
                    })
                };
                let available = v.available_bytes.min(v.total_bytes);
                let used = v.total_bytes - available;
                VolumeSample {
                    id,
                    name: v.name,
                    mount_point: v.mount_point,
                    file_system: v.file_system,
                    kind: v.kind,
                    removable: v.removable,
                    read_only: v.read_only,
                    total_bytes: v.total_bytes,
                    available_bytes: available,
                    used_bytes: used,
                    usage_percent: percent(used, v.total_bytes),
                    io,
                }
            })
            .collect();
        // Forget unmounted volumes so a re-mount starts fresh.
        self.reads.retain(|k| seen.contains(k));
        self.writes.retain(|k| seen.contains(k));
        out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
        out
    }

    /// Call after `Disks::refresh_specifics`.
    pub fn sample(&mut self, disks: &Disks, now: Instant) -> Vec<VolumeSample> {
        let raw = disks
            .iter()
            .map(|d| {
                let usage = d.usage();
                RawVolume {
                    name: d.name().to_string_lossy().into_owned(),
                    mount_point: d.mount_point().to_string_lossy().into_owned(),
                    file_system: d.file_system().to_string_lossy().into_owned(),
                    kind: d.kind().into(),
                    removable: d.is_removable(),
                    read_only: d.is_read_only(),
                    total_bytes: d.total_space(),
                    available_bytes: d.available_space(),
                    total_read_bytes: usage.total_read_bytes,
                    total_written_bytes: usage.total_written_bytes,
                }
            })
            .collect();
        self.build(raw, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn vol(mount: &str, total: u64, avail: u64, read: u64, written: u64) -> RawVolume {
        RawVolume {
            name: String::new(),
            mount_point: mount.into(),
            file_system: "NTFS".into(),
            kind: MediaKind::Ssd,
            removable: false,
            read_only: false,
            total_bytes: total,
            available_bytes: avail,
            total_read_bytes: read,
            total_written_bytes: written,
        }
    }

    #[test]
    fn capacity_and_percent() {
        let mut c = StorageCollector::new();
        let v = &c.build(vec![vol("C:\\", 1000, 250, 1, 1)], Instant::now())[0];
        assert_eq!(v.used_bytes, 750);
        assert_eq!(v.usage_percent, Some(75.0));
    }

    #[test]
    fn io_rates_from_counter_deltas() {
        let t0 = Instant::now();
        let mut c = StorageCollector::new();
        let first = c.build(vec![vol("C:\\", 1000, 500, 1_000, 2_000)], t0);
        let io = first[0].io.value().unwrap();
        assert_eq!(io.read_bytes_per_sec, None);

        let second = c.build(
            vec![vol("C:\\", 1000, 500, 3_000, 2_500)],
            t0 + Duration::from_secs(2),
        );
        let io = second[0].io.value().unwrap();
        assert_eq!(io.read_bytes_per_sec, Some(1_000.0));
        assert_eq!(io.write_bytes_per_sec, Some(250.0));
    }

    #[test]
    fn zero_counters_mean_unavailable_not_idle() {
        let mut c = StorageCollector::new();
        let v = c.build(vec![vol("D:\\", 1000, 500, 0, 0)], Instant::now());
        assert!(matches!(v[0].io, Reading::Unsupported { .. }));
    }

    #[test]
    fn unknown_capacity_and_inconsistent_values() {
        let mut c = StorageCollector::new();
        let v = c.build(
            vec![vol("X:\\", 0, 0, 1, 1), vol("Y:\\", 100, 200, 1, 1)],
            Instant::now(),
        );
        assert_eq!(v[0].usage_percent, None);
        assert_eq!(v[1].used_bytes, 0);
        assert_eq!(v[1].available_bytes, 100);
    }

    #[test]
    fn removed_volume_is_forgotten() {
        let t0 = Instant::now();
        let mut c = StorageCollector::new();
        c.build(vec![vol("E:\\", 1, 1, 100, 100)], t0);
        c.build(vec![], t0 + Duration::from_secs(1));
        let v = c.build(
            vec![vol("E:\\", 1, 1, 5_000, 5_000)],
            t0 + Duration::from_secs(2),
        );
        assert_eq!(v[0].io.value().unwrap().read_bytes_per_sec, None);
    }

    #[test]
    fn output_sorted_by_mount_point() {
        let mut c = StorageCollector::new();
        let v = c.build(
            vec![vol("D:\\", 1, 1, 1, 1), vol("C:\\", 1, 1, 1, 1)],
            Instant::now(),
        );
        assert_eq!(v[0].mount_point, "C:\\");
    }
}
