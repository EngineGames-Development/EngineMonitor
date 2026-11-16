//! Reads and writes on an open history database. All functions take a
//! connection so they can be used from the writer thread, from commands and
//! from tests (in-memory database) alike.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// One history row: averages over one recording window.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HistoryRecord {
    /// Window end, ms since the Unix epoch.
    pub ts_ms: i64,
    pub cpu: Option<f64>,
    pub cpu_max: Option<f64>,
    pub memory: Option<f64>,
    pub memory_used: Option<i64>,
    pub swap: Option<f64>,
    pub net_rx: Option<f64>,
    pub net_tx: Option<f64>,
    pub disk_read: Option<f64>,
    pub disk_write: Option<f64>,
    pub gpu: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VolumeRecord {
    pub ts_ms: i64,
    pub mount_point: String,
    pub used_bytes: i64,
    pub total_bytes: i64,
}

/// One bucket of a history query (averages; `cpu_max` is the maximum).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    /// Bucket start, ms since the Unix epoch.
    pub t: i64,
    pub cpu: Option<f64>,
    pub cpu_max: Option<f64>,
    pub memory: Option<f64>,
    pub swap: Option<f64>,
    pub net_rx: Option<f64>,
    pub net_tx: Option<f64>,
    pub disk_read: Option<f64>,
    pub disk_write: Option<f64>,
    pub gpu: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumePoint {
    pub t: i64,
    pub used_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeSeries {
    pub mount_point: String,
    pub points: Vec<VolumePoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStats {
    pub rows: i64,
    pub oldest_ms: Option<i64>,
    pub newest_ms: Option<i64>,
    /// Database file size including WAL, bytes.
    pub size_bytes: u64,
}

pub fn insert_batch(
    conn: &mut Connection,
    records: &[HistoryRecord],
    volumes: &[VolumeRecord],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO samples
             (ts, cpu, cpu_max, memory, memory_used, swap, net_rx, net_tx, disk_read, disk_write, gpu)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        for r in records {
            stmt.execute(params![
                r.ts_ms,
                r.cpu,
                r.cpu_max,
                r.memory,
                r.memory_used,
                r.swap,
                r.net_rx,
                r.net_tx,
                r.disk_read,
                r.disk_write,
                r.gpu
            ])?;
        }
        let mut stmt = tx.prepare_cached(
            "INSERT OR REPLACE INTO volume_samples (ts, mount_point, used_bytes, total_bytes)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        for v in volumes {
            stmt.execute(params![v.ts_ms, v.mount_point, v.used_bytes, v.total_bytes])?;
        }
    }
    tx.commit()
}

/// Averages rows in `[from_ms, to_ms)` into buckets of `bucket_ms`.
pub fn query(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    bucket_ms: i64,
) -> rusqlite::Result<Vec<HistoryPoint>> {
    let mut stmt = conn.prepare_cached(
        "SELECT (ts / ?3) * ?3 AS bucket,
                AVG(cpu), MAX(cpu_max), AVG(memory), AVG(swap),
                AVG(net_rx), AVG(net_tx), AVG(disk_read), AVG(disk_write), AVG(gpu)
         FROM samples
         WHERE ts >= ?1 AND ts < ?2
         GROUP BY bucket
         ORDER BY bucket",
    )?;
    let rows = stmt.query_map(params![from_ms, to_ms, bucket_ms.max(1)], |r| {
        Ok(HistoryPoint {
            t: r.get(0)?,
            cpu: r.get(1)?,
            cpu_max: r.get(2)?,
            memory: r.get(3)?,
            swap: r.get(4)?,
            net_rx: r.get(5)?,
            net_tx: r.get(6)?,
            disk_read: r.get(7)?,
            disk_write: r.get(8)?,
            gpu: r.get(9)?,
        })
    })?;
    rows.collect()
}

/// Per-volume used % in `[from_ms, to_ms)`, bucketed like [`query`].
pub fn query_volumes(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    bucket_ms: i64,
) -> rusqlite::Result<Vec<VolumeSeries>> {
    let mut stmt = conn.prepare_cached(
        "SELECT mount_point, (ts / ?3) * ?3 AS bucket,
                AVG(CAST(used_bytes AS REAL) * 100.0 / total_bytes)
         FROM volume_samples
         WHERE ts >= ?1 AND ts < ?2 AND total_bytes > 0
         GROUP BY mount_point, bucket
         ORDER BY mount_point, bucket",
    )?;
    let mut out: Vec<VolumeSeries> = Vec::new();
    let mut rows = stmt.query(params![from_ms, to_ms, bucket_ms.max(1)])?;
    while let Some(r) = rows.next()? {
        let mount: String = r.get(0)?;
        let point = VolumePoint {
            t: r.get(1)?,
            used_percent: r.get(2)?,
        };
        match out.last_mut() {
            Some(s) if s.mount_point == mount => s.points.push(point),
            _ => out.push(VolumeSeries {
                mount_point: mount,
                points: vec![point],
            }),
        }
    }
    Ok(out)
}

/// Deletes everything older than `cutoff_ms`, then returns freed pages to
/// the OS so the file shrinks. Returns the number of deleted sample rows.
pub fn cleanup(conn: &Connection, cutoff_ms: i64) -> rusqlite::Result<usize> {
    let n = conn.execute("DELETE FROM samples WHERE ts < ?1", [cutoff_ms])?;
    conn.execute("DELETE FROM volume_samples WHERE ts < ?1", [cutoff_ms])?;
    incremental_vacuum(conn)?;
    Ok(n)
}

/// Returns all free pages to the OS. `incremental_vacuum` frees one page per
/// step, so it has to be stepped to completion (`execute_batch` would only
/// step it once and free a single page).
fn incremental_vacuum(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA incremental_vacuum")?;
    let mut rows = stmt.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

pub fn clear(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("DELETE FROM samples; DELETE FROM volume_samples;")?;
    incremental_vacuum(conn)
}

pub fn stats(conn: &Connection, size_bytes: u64) -> rusqlite::Result<HistoryStats> {
    let (rows, oldest_ms, newest_ms) =
        conn.query_row("SELECT COUNT(*), MIN(ts), MAX(ts) FROM samples", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
    Ok(HistoryStats {
        rows,
        oldest_ms,
        newest_ms,
        size_bytes,
    })
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .optional()
}

pub fn put_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::schema::open_in_memory;

    fn rec(ts: i64, cpu: Option<f64>) -> HistoryRecord {
        HistoryRecord {
            ts_ms: ts,
            cpu,
            cpu_max: cpu,
            memory: Some(50.0),
            ..Default::default()
        }
    }

    #[test]
    fn insert_and_bucketed_query() {
        let mut c = open_in_memory().unwrap();
        insert_batch(
            &mut c,
            &[
                rec(1_000, Some(10.0)),
                rec(2_000, Some(30.0)),
                rec(11_000, Some(80.0)),
            ],
            &[],
        )
        .unwrap();
        let p = query(&c, 0, 20_000, 10_000).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].t, 0);
        assert_eq!(p[0].cpu, Some(20.0)); // mean
        assert_eq!(p[0].cpu_max, Some(30.0)); // max
        assert_eq!(p[1].t, 10_000);
        assert_eq!(p[1].cpu, Some(80.0));
        assert_eq!(p[0].gpu, None); // never measured stays NULL, not 0
    }

    #[test]
    fn nulls_are_ignored_by_averages() {
        let mut c = open_in_memory().unwrap();
        insert_batch(&mut c, &[rec(1, None), rec(2, Some(40.0))], &[]).unwrap();
        assert_eq!(query(&c, 0, 10, 10).unwrap()[0].cpu, Some(40.0));
    }

    #[test]
    fn query_range_is_half_open() {
        let mut c = open_in_memory().unwrap();
        insert_batch(&mut c, &[rec(100, Some(1.0)), rec(200, Some(2.0))], &[]).unwrap();
        assert_eq!(query(&c, 100, 200, 1).unwrap().len(), 1);
    }

    #[test]
    fn retention_cleanup_deletes_only_old_rows() {
        let mut c = open_in_memory().unwrap();
        insert_batch(
            &mut c,
            &[
                rec(100, Some(1.0)),
                rec(200, Some(2.0)),
                rec(300, Some(3.0)),
            ],
            &[VolumeRecord {
                ts_ms: 100,
                mount_point: "C:\\".into(),
                used_bytes: 1,
                total_bytes: 2,
            }],
        )
        .unwrap();
        assert_eq!(cleanup(&c, 250).unwrap(), 2);
        let s = stats(&c, 0).unwrap();
        assert_eq!(s.rows, 1);
        assert_eq!(s.oldest_ms, Some(300));
        assert!(query_volumes(&c, 0, 1_000, 1).unwrap().is_empty());
    }

    #[test]
    fn volume_series_grouped_per_mount() {
        let mut c = open_in_memory().unwrap();
        let v = |ts, m: &str, used| VolumeRecord {
            ts_ms: ts,
            mount_point: m.into(),
            used_bytes: used,
            total_bytes: 200,
        };
        insert_batch(
            &mut c,
            &[],
            &[v(0, "C:\\", 100), v(5, "C:\\", 150), v(0, "D:\\", 20)],
        )
        .unwrap();
        let s = query_volumes(&c, 0, 100, 100).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].mount_point, "C:\\");
        assert_eq!(s[0].points[0].used_percent, 62.5);
        assert_eq!(s[1].points[0].used_percent, 10.0);
    }

    #[test]
    fn duplicate_timestamp_replaces_instead_of_failing() {
        let mut c = open_in_memory().unwrap();
        insert_batch(&mut c, &[rec(1, Some(1.0))], &[]).unwrap();
        insert_batch(&mut c, &[rec(1, Some(9.0))], &[]).unwrap();
        assert_eq!(stats(&c, 0).unwrap().rows, 1);
    }

    #[test]
    fn clear_and_settings_roundtrip() {
        let mut c = open_in_memory().unwrap();
        insert_batch(&mut c, &[rec(1, Some(1.0))], &[]).unwrap();
        clear(&c).unwrap();
        assert_eq!(stats(&c, 0).unwrap().rows, 0);

        assert_eq!(get_setting(&c, "k").unwrap(), None);
        put_setting(&c, "k", "1").unwrap();
        put_setting(&c, "k", "2").unwrap();
        assert_eq!(get_setting(&c, "k").unwrap().as_deref(), Some("2"));
    }
}

#[cfg(test)]
mod file_tests {
    use super::*;
    use crate::history::schema::{open, tests::TempDb};

    #[test]
    fn cleanup_actually_shrinks_the_database() {
        let db = TempDb::new("shrink");
        let mut c = open(&db.0).unwrap();
        let rows: Vec<HistoryRecord> = (0..20_000)
            .map(|i| HistoryRecord {
                ts_ms: i,
                cpu: Some(1.0),
                memory: Some(2.0),
                net_rx: Some(3.0),
                ..Default::default()
            })
            .collect();
        insert_batch(&mut c, &rows, &[]).unwrap();
        let pages = |c: &Connection| -> i64 {
            c.pragma_query_value(None, "page_count", |r| r.get(0))
                .unwrap()
        };
        let before = pages(&c);
        cleanup(&c, i64::MAX).unwrap();
        let after = pages(&c);
        assert!(after < before / 4, "page_count {before} -> {after}");
        let free: i64 = c
            .pragma_query_value(None, "freelist_count", |r| r.get(0))
            .unwrap();
        assert_eq!(free, 0, "free pages returned to the OS");
    }
}
