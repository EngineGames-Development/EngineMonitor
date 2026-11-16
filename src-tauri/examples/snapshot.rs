//! Prints system info and a measured snapshot as JSON.
//!
//!     cargo run --example snapshot
//!
//! Useful for checking collector output against OS tools (Task Manager,
//! `top`, Activity Monitor) and for rough timing of a sampling tick.

use std::time::{Duration, Instant};

use enginemonitor_lib::system::SystemCollector;

fn main() {
    let mut collector = match SystemCollector::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("failed to initialise collectors: {e}");
            std::process::exit(1);
        }
    };

    println!(
        "{}",
        serde_json::to_string_pretty(&collector.info()).unwrap()
    );

    // The first tick only establishes baselines for deltas.
    collector.sample();
    std::thread::sleep(Duration::from_secs(1));

    let started = Instant::now();
    let snapshot = collector.sample();
    let elapsed = started.elapsed();

    println!("{}", serde_json::to_string_pretty(&snapshot).unwrap());
    eprintln!("sample() took {:.2} ms", elapsed.as_secs_f64() * 1000.0);
}
