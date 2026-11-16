//! Collectors against the real machine running the tests.
//!
//! These assert invariants that must hold on any supported system (there is
//! RAM, there is at least one CPU, percentages are in range, rates are never
//! negative). They do not assert specific values.

use std::time::Duration;

use enginemonitor_lib::reading::Reading;
use enginemonitor_lib::system::SystemCollector;

fn in_percent_range(v: f64) -> bool {
    (0.0..=100.0).contains(&v)
}

#[test]
fn system_info_is_populated() {
    let c = SystemCollector::new().expect("collector init");
    let info = c.info();
    assert!(info.os_name.is_some(), "OS name should be known");
    assert!(info.total_memory_bytes > 0);
    assert!(info.cpu.logical_cores > 0);
    if let Some(p) = info.cpu.physical_cores {
        assert!(p <= info.cpu.logical_cores);
    }
}

#[test]
fn first_sample_is_unprimed_second_is_measured() {
    let mut c = SystemCollector::new().expect("collector init");

    let first = c.sample();
    assert_eq!(
        first.cpu.usage_percent, None,
        "first tick must not claim 0 %"
    );
    assert_eq!(first.network.receive_bytes_per_sec, None);

    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(Duration::from_millis(300)));
    let s = c.sample();

    let usage = s.cpu.usage_percent.expect("second tick has CPU usage") as f64;
    assert!(in_percent_range(usage), "cpu usage {usage}");
    assert!(!s.cpu.cores.is_empty());
    for core in &s.cpu.cores {
        let u = core.usage_percent.expect("per-core usage") as f64;
        assert!(in_percent_range(u), "core usage {u}");
    }
    assert!(s.timestamp_ms > first.timestamp_ms);
    assert!(s.uptime_secs.unwrap_or(1) > 0);

    // Memory
    let m = &s.memory;
    assert!(m.total_bytes > 0);
    assert!(m.used_bytes <= m.total_bytes);
    assert!(in_percent_range(m.usage_percent.unwrap()));

    // Storage: the volume holding the test binary must be listed.
    assert!(!s.storage.is_empty(), "at least one volume");
    for v in &s.storage {
        assert!(v.used_bytes + v.available_bytes == v.total_bytes);
        if let Some(p) = v.usage_percent {
            assert!(in_percent_range(p));
        }
        if let Reading::Ok { value: io } = &v.io {
            for r in [io.read_bytes_per_sec, io.write_bytes_per_sec]
                .into_iter()
                .flatten()
            {
                assert!(r >= 0.0);
            }
        }
    }

    // Network rates, where present, are non-negative.
    for i in &s.network.interfaces {
        for r in [i.receive_bytes_per_sec, i.transmit_bytes_per_sec]
            .into_iter()
            .flatten()
        {
            assert!(r >= 0.0, "{} rate {r}", i.name);
        }
    }
}

#[test]
fn load_average_matches_platform_support() {
    let mut c = SystemCollector::new().expect("collector init");
    let s = c.sample();
    if cfg!(windows) {
        assert!(
            matches!(s.cpu.load_average, Reading::Unsupported { .. }),
            "Windows has no load average; it must be reported as unsupported"
        );
    } else {
        assert!(matches!(s.cpu.load_average, Reading::Ok { .. }));
    }
}

#[test]
fn snapshot_serialises_to_camel_case_json() {
    let mut c = SystemCollector::new().expect("collector init");
    let json = serde_json::to_value(c.sample()).unwrap();
    for key in [
        "timestampMs",
        "uptimeSecs",
        "cpu",
        "memory",
        "storage",
        "network",
    ] {
        assert!(json.get(key).is_some(), "missing {key}");
    }
    assert!(json["cpu"]
        .get("loadAverage")
        .unwrap()
        .get("status")
        .is_some());
    assert!(json["memory"].get("totalBytes").is_some());
}
