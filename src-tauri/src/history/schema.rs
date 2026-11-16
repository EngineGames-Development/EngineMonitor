//! Database opening, pragmas and migrations.
//!
//! The schema version lives in `PRAGMA user_version`. Migrations run in a
//! transaction, in order, and are never edited once released — add a new one
//! instead. A database written by a *newer* EngineMonitor is refused rather
//! than modified.

use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

/// Ordered migrations; index + 1 = resulting schema version.
const MIGRATIONS: &[&str] = &[
    // v1: history samples, per-volume storage samples, key/value settings.
    r#"
    CREATE TABLE samples (
        ts          INTEGER PRIMARY KEY,  -- window end, ms since Unix epoch
        cpu         REAL,                 -- mean utilisation %, NULL = not measured
        cpu_max     REAL,                 -- highest tick in the window
        memory      REAL,                 -- mean utilisation %
        memory_used INTEGER,              -- mean bytes in use
        swap        REAL,                 -- mean swap utilisation %, NULL = no swap
        net_rx      REAL,                 -- mean bytes/s, non-loopback total
        net_tx      REAL,
        disk_read   REAL,                 -- mean bytes/s, volumes with counters
        disk_write  REAL,
        gpu         REAL                  -- mean utilisation % of busiest adapter
    );
    CREATE TABLE volume_samples (
        ts          INTEGER NOT NULL,
        mount_point TEXT    NOT NULL,
        used_bytes  INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL,
        PRIMARY KEY (mount_point, ts)
    ) WITHOUT ROWID;
    CREATE INDEX volume_samples_ts ON volume_samples (ts);
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL              -- JSON
    ) WITHOUT ROWID;
    "#,
];

pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    #[error("could not create the data directory {path}: {source}")]
    CreateDir {
        path: String,
        source: std::io::Error,
    },
    #[error("could not open the history database: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error(
        "the history database was created by a newer EngineMonitor (schema {found}, supported {supported})"
    )]
    TooNew { found: i64, supported: i64 },
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    // WAL: readers (commands) never block the writer thread and vice versa.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // NORMAL is durable against application crashes; on power loss the last
    // committed batch may be lost, which is acceptable for monitoring history.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

pub fn migrate(conn: &mut Connection) -> Result<(), OpenError> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(OpenError::TooNew {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    if version == 0 {
        // Must be set before the first table exists to take effect.
        conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// Opens (creating if needed) and migrates the database at `path`.
pub fn open(path: &Path) -> Result<Connection, OpenError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|source| OpenError::CreateDir {
            path: dir.display().to_string(),
            source,
        })?;
    }
    let mut conn = Connection::open(path)?;
    // auto_vacuum must be set on a brand-new database *before* anything
    // writes the file header — including switching to WAL — or SQLite
    // silently ignores it and the file would never shrink after cleanup.
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version == 0 {
        conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    }
    configure(&conn)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// In-memory database with the full schema (tests).
pub fn open_in_memory() -> Result<Connection, OpenError> {
    let mut conn = Connection::open_in_memory()?;
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Unique temp path, removed (with WAL files) on drop.
    pub(crate) struct TempDb(pub PathBuf);
    impl TempDb {
        pub(crate) fn new(tag: &str) -> Self {
            let n = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Self(
                std::env::temp_dir()
                    .join(format!(
                        "enginemonitor-test-{tag}-{}-{n}",
                        std::process::id()
                    ))
                    .join("history.sqlite3"),
            )
        }
    }
    impl Drop for TempDb {
        fn drop(&mut self) {
            if let Some(dir) = self.0.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    #[test]
    fn creates_schema_and_is_idempotent() {
        let db = TempDb::new("schema");
        {
            let conn = open(&db.0).unwrap();
            let v: i64 = conn
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap();
            assert_eq!(v, SCHEMA_VERSION);
            let mode: String = conn
                .pragma_query_value(None, "journal_mode", |r| r.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
            let av: i64 = conn
                .pragma_query_value(None, "auto_vacuum", |r| r.get(0))
                .unwrap();
            assert_eq!(av, 2, "incremental auto_vacuum");
        }
        // Re-opening an up-to-date database changes nothing.
        let conn = open(&db.0).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn refuses_database_from_newer_version() {
        let db = TempDb::new("newer");
        {
            let conn = open(&db.0).unwrap();
            conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
                .unwrap();
        }
        assert!(matches!(open(&db.0), Err(OpenError::TooNew { .. })));
    }

    #[test]
    fn corrupt_file_is_an_error_not_a_panic_and_is_not_deleted() {
        let db = TempDb::new("corrupt");
        std::fs::create_dir_all(db.0.parent().unwrap()).unwrap();
        std::fs::write(
            &db.0,
            b"this is definitely not a sqlite database, just junk bytes....",
        )
        .unwrap();
        assert!(open(&db.0).is_err());
        assert!(
            db.0.exists(),
            "user data must never be deleted automatically"
        );
    }
}
