//! Times each part of a sampling tick separately.
//!
//!     cargo run --release --example tick_breakdown
//!
//! Prints the median of 10 ticks (1 s apart) for each collector so slow
//! sources can be identified. Measures this machine only.

use std::time::{Duration, Instant};

use enginemonitor_lib::gpu::GpuMonitor;
use sysinfo::{
    CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System,
};

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn time(f: impl FnOnce()) -> f64 {
    let t = Instant::now();
    f();
    t.elapsed().as_secs_f64() * 1000.0
}

fn main() {
    let cpu_kind = CpuRefreshKind::nothing().with_usage().with_frequency();
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(cpu_kind)).unwrap();
    let mut disks = Disks::new_with_refreshed_list().unwrap();
    let mut nets = Networks::new_with_refreshed_list().unwrap();
    let mut gpu = GpuMonitor::new();

    let names = [
        "cpu usage",
        "cpu frequency",
        "memory",
        "disks",
        "networks",
        "gpu",
    ];
    let mut samples: Vec<Vec<f64>> = vec![Vec::new(); names.len()];
    for _ in 0..11 {
        std::thread::sleep(Duration::from_secs(1));
        let t = [
            time(|| sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_usage())),
            time(|| sys.refresh_cpu_specifics(CpuRefreshKind::nothing().with_frequency())),
            time(|| {
                sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram().with_swap())
            }),
            time(|| {
                disks.refresh_specifics(
                    true,
                    DiskRefreshKind::nothing()
                        .with_kind()
                        .with_storage()
                        .with_io_usage(),
                )
            }),
            time(|| nets.refresh(true)),
            time(|| {
                let _ = gpu.sample();
            }),
        ];
        for (i, v) in t.into_iter().enumerate() {
            samples[i].push(v);
        }
    }
    for (name, s) in names.iter().zip(samples) {
        println!("{name:>14}: median {:6.2} ms", median(s));
    }
}
