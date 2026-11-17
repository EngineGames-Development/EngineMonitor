//! Persistent metric history (SQLite).
//!
//! * [`Recorder`] lives on the sampler thread: it averages live ticks into
//!   windows ([`accumulator`]) and hands finished rows to the writer without
//!   blocking.
//! * [`writer::HistoryWriter`] is the single writer: batched transactions,
//!   retention cleanup, incremental vacuum.
//! * [`History`] serves commands: settings, bucketed queries, stats, clear.
//!   It uses its own read connection; WAL mode lets reads run concurrently
//!   with the writer.

pub mod accumulator;
pub mod schema;
pub mod store;
pub mod writer;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex, PoisonError};

use rusqlite::Connection;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::settings::{self, HistorySettings};
use crate::system::Snapshot;
use accumulator::Accumulator;
use store::{HistoryPoint, HistoryStats, VolumeSeries};
use writer::{HistoryWriter, Msg};

pub const DB_FILE_NAME: &str = "history.sqlite3";
/// Longest range a single query may cover.
pub const MAX_QUERY_RANGE_MS: i64 = 400 * 86_400_000;
pub const MIN_POINTS: u32 = 10;
pub const MAX_POINTS: u32 = 2_000;

/// Live view of the history settings shared with the sampler thread.
#[derive(Debug)]
struct Config {
    enabled: AtomicBool,
    interval_secs: AtomicU32,
    retention_days: Arc<AtomicU32>,
}

impl Config {
    fn new(s: HistorySettings) -> Self {
        Self {
            enabled: AtomicBool::new(s.enabled),
            interval_secs: AtomicU32::new(s.interval_secs),
            retention_days: Arc::new(AtomicU32::new(s.retention_days)),
        }
    }
    fn store(&self, s: HistorySettings) {
        self.enabled.store(s.enabled, Ordering::Relaxed);
        self.interval_secs.store(s.interval_secs, Ordering::Relaxed);
        self.retention_days
            .store(s.retention_days, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub from_ms: i64,
    pub to_ms: i64,
    /// Width of one returned point. Gaps longer than this mean no data.
    pub bucket_ms: i64,
    pub points: Vec<HistoryPoint>,
    pub volumes: Vec<VolumeSeries>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStatus {
    pub settings: HistorySettings,
    pub stats: HistoryStats,
    /// Rough size at full retention with the current settings.
    pub estimated_size_bytes: u64,
    /// Last write/cleanup error, if the most recent attempt failed.
    pub last_error: Option<String>,
    pub database_path: String,
}

/// Validates a query and derives the bucket width.
pub fn plan_query(from_ms: i64, to_ms: i64, max_points: u32, interval_secs: u32) -> AppResult<i64> {
    if from_ms < 0 || to_ms <= from_ms {
        return Err(AppError::InvalidArgument(
            "the end of the range must be after its start".into(),
        ));
    }
    if to_ms - from_ms > MAX_QUERY_RANGE_MS {
        return Err(AppError::InvalidArgument(
            "the range may cover at most 400 days".into(),
        ));
    }
    if !(MIN_POINTS..=MAX_POINTS).contains(&max_points) {
        return Err(AppError::InvalidArgument(format!(
            "maxPoints must be between {MIN_POINTS} and {MAX_POINTS}"
        )));
    }
    let span = to_ms - from_ms;
    let per_point = (span + i64::from(max_points) - 1) / i64::from(max_points);
    Ok(per_point.max(i64::from(interval_secs) * 1_000))
}

fn file_size(path: &Path) -> u64 {
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    [path.to_path_buf(), wal]
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

fn db_err(e: rusqlite::Error) -> AppError {
    AppError::Internal(format!("history database error: {e}"))
}

pub struct History {
    path: PathBuf,
    reader: Mutex<Connection>,
    writer: HistoryWriter,
    config: Arc<Config>,
}

impl History {
    /// Opens the database at `path` and starts the writer thread.
    /// `on_commit` runs on the writer thread after each committed batch.
    pub fn open(path: PathBuf, on_commit: impl Fn() + Send + 'static) -> AppResult<Self> {
        let to_err =
            |e: schema::OpenError| AppError::Internal(format!("{e} (file: {})", path.display()));
        let reader = schema::open(&path).map_err(to_err)?;
        let writer_conn = schema::open(&path).map_err(to_err)?;
        let config = Arc::new(Config::new(settings::load_history(&reader)));
        let writer =
            HistoryWriter::spawn(writer_conn, Arc::clone(&config.retention_days), on_commit)
                .map_err(|e| {
                    AppError::Internal(format!("could not start the history writer: {e}"))
                })?;
        Ok(Self {
            path,
            reader: Mutex::new(reader),
            writer,
            config,
        })
    }

    fn reader(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.reader.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs `f` with the read connection (also used for settings writes).
    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        f(&self.reader())
    }

    pub fn settings(&self) -> HistorySettings {
        HistorySettings {
            enabled: self.config.enabled.load(Ordering::Relaxed),
            interval_secs: self.config.interval_secs.load(Ordering::Relaxed),
            retention_days: self.config.retention_days.load(Ordering::Relaxed),
        }
    }

    pub fn set_settings(&self, s: HistorySettings) -> AppResult<HistorySettings> {
        settings::save_history(&self.reader(), &s)?;
        let shorter_retention = s.retention_days < self.settings().retention_days;
        self.config.store(s);
        if shorter_retention {
            self.writer.request_cleanup().map_err(AppError::Internal)?;
        }
        Ok(s)
    }

    pub fn query(&self, from_ms: i64, to_ms: i64, max_points: u32) -> AppResult<HistoryQuery> {
        let bucket_ms = plan_query(from_ms, to_ms, max_points, self.settings().interval_secs)?;
        let conn = self.reader();
        Ok(HistoryQuery {
            from_ms,
            to_ms,
            bucket_ms,
            points: store::query(&conn, from_ms, to_ms, bucket_ms).map_err(db_err)?,
            volumes: store::query_volumes(&conn, from_ms, to_ms, bucket_ms).map_err(db_err)?,
        })
    }

    pub fn status(&self) -> AppResult<HistoryStatus> {
        let settings = self.settings();
        Ok(HistoryStatus {
            settings,
            stats: store::stats(&self.reader(), file_size(&self.path)).map_err(db_err)?,
            estimated_size_bytes: settings.estimated_size_bytes(),
            last_error: self.writer.last_error(),
            database_path: self.path.display().to_string(),
        })
    }

    pub fn clear(&self) -> AppResult<()> {
        self.writer.clear().map_err(AppError::Internal)
    }

    /// Commits buffered rows now (used by tests).
    pub fn flush(&self) -> AppResult<()> {
        self.writer.flush().map_err(AppError::Internal)
    }

    /// The sampler-side recorder. Returns `None` once shut down.
    pub fn recorder(&self) -> Option<Recorder> {
        Some(Recorder {
            tx: self.writer.sender()?,
            config: Arc::clone(&self.config),
            acc: Accumulator::new(),
            was_enabled: false,
            dropped: 0,
        })
    }

    /// Commits pending rows and stops the writer. Stop the sampler first so
    /// its recorder (holding a sender) is gone.
    pub fn shutdown(&self) {
        self.writer.shutdown();
    }
}

/// Owned by the sampler thread.
pub struct Recorder {
    tx: SyncSender<Msg>,
    config: Arc<Config>,
    acc: Accumulator,
    was_enabled: bool,
    dropped: u64,
}

impl Recorder {
    pub fn observe(&mut self, s: &Snapshot) {
        if !self.config.enabled.load(Ordering::Relaxed) {
            self.was_enabled = false;
            return;
        }
        if !self.was_enabled {
            // Don't average across a period in which recording was off.
            self.acc.reset();
            self.was_enabled = true;
        }
        self.acc.add(s);
        let interval_ms = i64::from(self.config.interval_secs.load(Ordering::Relaxed)) * 1_000;
        if let Some(record) = self.acc.take_if_due(s.timestamp_ms as i64, interval_ms) {
            let volumes = self.acc.volumes_if_due(s);
            if !writer::try_record(&self.tx, record, volumes) {
                self.dropped += 1;
                if self.dropped == 1 || self.dropped.is_power_of_two() {
                    eprintln!(
                        "EngineMonitor: history writer is saturated; {} record(s) dropped",
                        self.dropped
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_plan_validates_and_buckets() {
        // 1 hour into 360 points = 10 s buckets.
        assert_eq!(plan_query(0, 3_600_000, 360, 5).unwrap(), 10_000);
        // Bucket never smaller than the recording interval.
        assert_eq!(plan_query(0, 60_000, 2_000, 5).unwrap(), 5_000);
        assert!(plan_query(10, 10, 100, 5).is_err());
        assert!(plan_query(-1, 10, 100, 5).is_err());
        assert!(plan_query(0, MAX_QUERY_RANGE_MS + 1, 100, 5).is_err());
        assert!(plan_query(0, 1_000, 5, 5).is_err());
        assert!(plan_query(0, 1_000, 5_000, 5).is_err());
    }
}
