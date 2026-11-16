//! Operating-system facts and the aggregate collector.
//!
//! `SystemCollector` is the single owner of all `sysinfo` state. Keeping one
//! long-lived instance matters: CPU usage and transfer rates are deltas
//! between consecutive refreshes, and re-creating `sysinfo` objects would also
//! re-allocate their internal tables every tick.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{
    CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System,
};

use crate::cpu::{self, CpuCollector, CpuInfo, CpuSample};
use crate::error::{AppError, AppResult};
use crate::memory::{self, MemorySample};
use crate::network::{NetworkCollector, NetworkSample};
use crate::storage::{StorageCollector, VolumeSample};

/// Facts that do not change while the app runs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// e.g. "Windows", "Ubuntu", "Darwin".
    pub os_name: Option<String>,
    /// e.g. "11 (26300)", "24.04".
    pub os_version: Option<String>,
    /// e.g. "Windows 11 Pro", "Linux 24.04 Ubuntu".
    pub os_long_name: Option<String>,
    pub kernel_version: Option<String>,
    /// Seconds since the Unix epoch.
    pub boot_time_secs: Option<u64>,
    pub cpu: CpuInfo,
    pub total_memory_bytes: u64,
}

/// One tick of measurements.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Wall-clock time of the sample, milliseconds since the Unix epoch.
    pub timestamp_ms: u64,
    pub uptime_secs: Option<u64>,
    pub cpu: CpuSample,
    pub memory: MemorySample,
    pub storage: Vec<VolumeSample>,
    pub network: NetworkSample,
}

fn to_app_error(e: sysinfo::Error, what: &str) -> AppError {
    match e {
        sysinfo::Error::Unsupported => {
            AppError::Unsupported(format!("{what} is not supported on this platform"))
        }
        other => AppError::Internal(format!("failed to initialise {what}: {other}")),
    }
}

fn non_empty(r: Result<String, sysinfo::Error>) -> Option<String> {
    r.ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn cpu_refresh() -> CpuRefreshKind {
    CpuRefreshKind::nothing().with_usage().with_frequency()
}

fn memory_refresh() -> MemoryRefreshKind {
    MemoryRefreshKind::nothing().with_ram().with_swap()
}

fn disk_refresh() -> DiskRefreshKind {
    DiskRefreshKind::nothing()
        .with_kind()
        .with_storage()
        .with_io_usage()
}

pub struct SystemCollector {
    sys: System,
    disks: Disks,
    networks: Networks,
    cpu: CpuCollector,
    storage: StorageCollector,
    network: NetworkCollector,
}

impl SystemCollector {
    /// Initialises all `sysinfo` sources. This is the only fallible step;
    /// afterwards sampling never fails as a whole (individual metrics carry
    /// their own availability).
    pub fn new() -> AppResult<Self> {
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(cpu_refresh())
                .with_memory(memory_refresh()),
        )
        .map_err(|e| to_app_error(e, "system information"))?;
        let disks = Disks::new_with_refreshed_list_specifics(disk_refresh())
            .map_err(|e| to_app_error(e, "disk information"))?;
        let networks = Networks::new_with_refreshed_list()
            .map_err(|e| to_app_error(e, "network information"))?;
        Ok(Self {
            sys,
            disks,
            networks,
            cpu: CpuCollector::new(),
            storage: StorageCollector::new(),
            network: NetworkCollector::new(),
        })
    }

    pub fn info(&self) -> SystemInfo {
        SystemInfo {
            os_name: non_empty(System::name()),
            os_version: non_empty(System::os_version()),
            os_long_name: non_empty(System::long_os_version()),
            kernel_version: non_empty(System::kernel_version()),
            boot_time_secs: System::boot_time().ok().filter(|&t| t > 0),
            cpu: cpu::cpu_info(&self.sys),
            total_memory_bytes: self.sys.total_memory(),
        }
    }

    /// Refreshes every source and returns one snapshot. The first snapshot
    /// after construction has no CPU usage and no transfer rates (no previous
    /// values to compare against).
    pub fn sample(&mut self) -> Snapshot {
        self.sys.refresh_cpu_specifics(cpu_refresh());
        self.sys.refresh_memory_specifics(memory_refresh());
        // `true`: drop volumes/interfaces that disappeared; new ones are added.
        self.disks.refresh_specifics(true, disk_refresh());
        self.networks.refresh(true);
        let now = Instant::now();

        Snapshot {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            uptime_secs: System::uptime().ok(),
            cpu: self.cpu.sample(&self.sys),
            memory: memory::sample(&self.sys),
            storage: self.storage.sample(&self.disks, now),
            network: self.network.sample(&self.networks, now),
        }
    }
}
