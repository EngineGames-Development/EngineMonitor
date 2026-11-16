//! Measures real on-disk size per history row.
//!
//!     cargo run --release --example history_size
//!
//! Writes 7 days of rows at a 5 s interval (the defaults) with realistic,
//! varying values into a temporary database, checkpoints the WAL, and
//! prints the file size and bytes per row. The temp database is deleted.

use enginemonitor_lib::history::{schema, store};

fn main() {
    let dir = std::env::temp_dir().join(format!("enginemonitor-size-{}", std::process::id()));
    let path = dir.join("history.sqlite3");
    let mut conn = schema::open(&path).expect("open");

    let rows = 7 * 86_400 / 5;
    let start = 1_800_000_000_000_i64;
    let mut batch = Vec::with_capacity(6);
    for i in 0..rows {
        let x = i as f64;
        batch.push(store::HistoryRecord {
            ts_ms: start + i * 5_000,
            cpu: Some(20.0 + (x * 0.37).sin() * 15.0),
            cpu_max: Some(40.0 + (x * 0.11).cos() * 30.0),
            memory: Some(60.0 + (x * 0.01).sin() * 5.0),
            memory_used: Some(9_000_000_000 + (i * 7919) % 500_000_000),
            swap: Some(30.0 + (x * 0.02).sin()),
            net_rx: Some(((x * 1.3).sin().abs()) * 2.0e6),
            net_tx: Some(((x * 0.7).cos().abs()) * 1.5e5),
            disk_read: Some(((x * 0.9).sin().abs()) * 3.0e7),
            disk_write: Some(((x * 0.4).cos().abs()) * 5.0e6),
            gpu: Some(((x * 0.05).sin().abs()) * 50.0),
        });
        if batch.len() == 6 {
            store::insert_batch(&mut conn, &batch, &[]).unwrap();
            batch.clear();
        }
    }
    store::insert_batch(&mut conn, &batch, &[]).unwrap();
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    drop(conn);

    let size = std::fs::metadata(&path).unwrap().len();
    println!(
        "{rows} rows -> {:.2} MiB, {:.1} bytes/row",
        size as f64 / 1_048_576.0,
        size as f64 / rows as f64
    );
    let _ = std::fs::remove_dir_all(dir);
}
