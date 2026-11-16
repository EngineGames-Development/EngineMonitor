//! Process list.
//!
//! Collected only while the frontend asks for it (Processes page open),
//! because refreshing every process is the most expensive part of sampling.
//!
//! * CPU is normalised to the whole machine (0–100 %, like Task Manager),
//!   not per core. It is `None` for a process's first tick, and for every
//!   process on the first tick after collection was (re)enabled, because
//!   `sysinfo` derives it from the time since the previous refresh.
//! * Processes are identified by (PID, start time) so a PID reused by a new
//!   process never inherits the old one's counters.
//! * No command lines or environment are collected: they can contain secrets
//!   and are not needed for monitoring.

pub mod terminate;

use std::collections::HashSet;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

use crate::rate::RateMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSample {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    /// `None` when the OS does not reveal it (protected process, other user).
    pub exe: Option<String>,
    pub status: String,
    /// Share of total machine CPU, 0–100.
    pub cpu_percent: Option<f32>,
    /// Resident memory (working set on Windows).
    pub memory_bytes: u64,
    pub virtual_memory_bytes: u64,
    pub disk_read_bytes_per_sec: Option<f64>,
    pub disk_write_bytes_per_sec: Option<f64>,
    /// Seconds since the Unix epoch. Together with `pid` it identifies the process.
    pub start_time_secs: u64,
    pub run_time_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessList {
    pub processes: Vec<ProcessSample>,
    /// EngineMonitor's own PID, so the UI can mark it and refuse to end it.
    pub own_pid: u32,
}

pub fn status_label(s: ProcessStatus) -> &'static str {
    match s {
        ProcessStatus::Run => "running",
        ProcessStatus::Sleep => "sleeping",
        ProcessStatus::Idle => "idle",
        ProcessStatus::Stop => "stopped",
        ProcessStatus::Zombie => "zombie",
        ProcessStatus::Tracing => "tracing",
        ProcessStatus::Dead => "dead",
        ProcessStatus::UninterruptibleDiskSleep => "disk sleep",
        _ => "unknown",
    }
}

/// CPU share of the whole machine from `sysinfo`'s per-core-summed value.
pub fn normalise_cpu(raw: f32, logical_cores: usize) -> Option<f32> {
    if !raw.is_finite() || logical_cores == 0 {
        return None;
    }
    Some((raw / logical_cores as f32).clamp(0.0, 100.0))
}

type ProcessKey = (u32, u64);

/// Raw per-process values, decoupled from `sysinfo` for testing.
#[derive(Debug, Clone)]
pub struct RawProcess {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub exe: Option<String>,
    pub status: &'static str,
    pub cpu_raw: f32,
    pub memory_bytes: u64,
    pub virtual_memory_bytes: u64,
    pub total_read_bytes: u64,
    pub total_written_bytes: u64,
    pub start_time_secs: u64,
    pub run_time_secs: u64,
}

#[derive(Debug, Default)]
pub struct ProcessCollector {
    /// Processes present in the previous tick (their CPU value is valid now).
    seen: HashSet<ProcessKey>,
    reads: RateMap<ProcessKey>,
    writes: RateMap<ProcessKey>,
}

impl ProcessCollector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Forget all state; the next tick reports no CPU or disk rates.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn build(
        &mut self,
        raw: Vec<RawProcess>,
        logical_cores: usize,
        now: Instant,
    ) -> Vec<ProcessSample> {
        let mut current = HashSet::with_capacity(raw.len());
        let out = raw
            .into_iter()
            .map(|p| {
                let key = (p.pid, p.start_time_secs);
                current.insert(key);
                let primed = self.seen.contains(&key);
                ProcessSample {
                    cpu_percent: if primed {
                        normalise_cpu(p.cpu_raw, logical_cores)
                    } else {
                        None
                    },
                    disk_read_bytes_per_sec: self.reads.update(&key, p.total_read_bytes, now),
                    disk_write_bytes_per_sec: self.writes.update(&key, p.total_written_bytes, now),
                    pid: p.pid,
                    parent_pid: p.parent_pid,
                    name: p.name,
                    exe: p.exe,
                    status: p.status.to_owned(),
                    memory_bytes: p.memory_bytes,
                    virtual_memory_bytes: p.virtual_memory_bytes,
                    start_time_secs: p.start_time_secs,
                    run_time_secs: p.run_time_secs,
                }
            })
            .collect();
        self.reads.retain(|k| current.contains(k));
        self.writes.retain(|k| current.contains(k));
        self.seen = current;
        out
    }

    /// Refreshes all processes in `sys` and returns the list.
    pub fn sample(&mut self, sys: &mut System, now: Instant) -> ProcessList {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_disk_usage()
                .with_exe(UpdateKind::OnlyIfNotSet),
        );
        let logical_cores = sys.cpus().len();
        let raw = sys
            .processes()
            .values()
            .map(|p| {
                let usage = p.disk_usage();
                RawProcess {
                    pid: p.pid().as_u32(),
                    parent_pid: p.parent().map(Pid::as_u32),
                    name: p.name().to_string_lossy().into_owned(),
                    exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
                    status: status_label(p.status()),
                    cpu_raw: p.cpu_usage(),
                    memory_bytes: p.memory(),
                    virtual_memory_bytes: p.virtual_memory(),
                    total_read_bytes: usage.total_read_bytes,
                    total_written_bytes: usage.total_written_bytes,
                    start_time_secs: p.start_time(),
                    run_time_secs: p.run_time(),
                }
            })
            .collect();
        ProcessList {
            processes: self.build(raw, logical_cores, now),
            own_pid: std::process::id(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn raw(pid: u32, start: u64, cpu: f32, read: u64) -> RawProcess {
        RawProcess {
            pid,
            parent_pid: None,
            name: format!("p{pid}"),
            exe: None,
            status: "running",
            cpu_raw: cpu,
            memory_bytes: 1,
            virtual_memory_bytes: 1,
            total_read_bytes: read,
            total_written_bytes: 0,
            start_time_secs: start,
            run_time_secs: 1,
        }
    }

    #[test]
    fn cpu_is_normalised_to_whole_machine() {
        assert_eq!(normalise_cpu(200.0, 4), Some(50.0));
        assert_eq!(normalise_cpu(450.0, 4), Some(100.0));
        assert_eq!(normalise_cpu(f32::NAN, 4), None);
        assert_eq!(normalise_cpu(10.0, 0), None);
    }

    #[test]
    fn first_tick_of_a_process_has_no_cpu_or_rates() {
        let t0 = Instant::now();
        let mut c = ProcessCollector::new();
        let s = c.build(vec![raw(10, 100, 80.0, 1_000)], 4, t0);
        assert_eq!(s[0].cpu_percent, None);
        assert_eq!(s[0].disk_read_bytes_per_sec, None);

        let s = c.build(
            vec![raw(10, 100, 80.0, 3_000)],
            4,
            t0 + Duration::from_secs(1),
        );
        assert_eq!(s[0].cpu_percent, Some(20.0));
        assert_eq!(s[0].disk_read_bytes_per_sec, Some(2_000.0));
    }

    #[test]
    fn reused_pid_is_treated_as_new_process() {
        let t0 = Instant::now();
        let mut c = ProcessCollector::new();
        c.build(vec![raw(10, 100, 10.0, 1_000_000)], 4, t0);
        // PID 10 exited; a new process got PID 10 with a different start time.
        let s = c.build(vec![raw(10, 200, 10.0, 50)], 4, t0 + Duration::from_secs(1));
        assert_eq!(s[0].cpu_percent, None);
        assert_eq!(s[0].disk_read_bytes_per_sec, None);
    }

    #[test]
    fn reset_unprimes_everything() {
        let t0 = Instant::now();
        let mut c = ProcessCollector::new();
        c.build(vec![raw(1, 1, 10.0, 0)], 1, t0);
        c.reset();
        let s = c.build(vec![raw(1, 1, 10.0, 0)], 1, t0 + Duration::from_secs(1));
        assert_eq!(s[0].cpu_percent, None);
    }

    #[test]
    fn samples_real_processes_including_self() {
        let mut sys = System::new().unwrap();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        let mut c = ProcessCollector::new();
        let list = c.sample(&mut sys, Instant::now());
        assert!(list.processes.len() > 1);
        let me = list
            .processes
            .iter()
            .find(|p| p.pid == list.own_pid)
            .expect("own process listed");
        assert!(me.memory_bytes > 0);
        assert!(me.exe.is_some(), "own executable path is always readable");
    }
}
