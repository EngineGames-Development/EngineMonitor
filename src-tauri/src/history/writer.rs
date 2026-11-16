//! Background writer thread: the only writer of history rows.
//!
//! Records arrive over a bounded channel and are committed in batches (one
//! transaction per batch) so the disk sees a write every ~15–30 s instead of
//! every tick. Retention cleanup runs at start-up, hourly, and whenever the
//! retention setting changes. A failing write is reported (logged once per
//! failure streak and exposed via `last_error`) and never stops monitoring.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use super::store::{self, HistoryRecord, VolumeRecord};

/// Commit when this many records are buffered…
const MAX_BATCH: usize = 6;
/// …or when nothing has been committed for this long.
const FLUSH_AFTER: Duration = Duration::from_secs(15);
const CLEANUP_EVERY: Duration = Duration::from_secs(3_600);
/// Channel capacity; at a 1 s history interval this is ~4 minutes of slack.
const CHANNEL_CAPACITY: usize = 256;
const DAY_MS: i64 = 86_400_000;

pub enum Msg {
    Record(HistoryRecord, Vec<VolumeRecord>),
    /// Run retention cleanup now (retention changed).
    Cleanup,
    /// Delete all history; replies when done.
    Clear(mpsc::Sender<Result<(), String>>),
    /// Commit pending rows; replies when done (tests, shutdown).
    Flush(mpsc::Sender<()>),
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

struct Worker {
    conn: Connection,
    retention_days: Arc<AtomicU32>,
    records: Vec<HistoryRecord>,
    volumes: Vec<VolumeRecord>,
    last_error: Arc<Mutex<Option<String>>>,
    on_commit: Box<dyn Fn() + Send>,
}

impl Worker {
    fn report(&self, result: Result<(), String>) {
        let mut slot = self
            .last_error
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        match result {
            Ok(()) => *slot = None,
            Err(e) => {
                if slot.is_none() {
                    eprintln!("EngineMonitor: history write failed: {e}");
                }
                *slot = Some(e);
            }
        }
    }

    fn flush(&mut self) {
        if self.records.is_empty() && self.volumes.is_empty() {
            return;
        }
        let result = store::insert_batch(&mut self.conn, &self.records, &self.volumes)
            .map_err(|e| e.to_string());
        let ok = result.is_ok();
        self.report(result);
        // On failure the batch is dropped: retrying forever would grow memory
        // without bound if the disk is full or the file is read-only.
        self.records.clear();
        self.volumes.clear();
        if ok {
            (self.on_commit)();
        }
    }

    fn cleanup(&mut self) {
        let days = i64::from(self.retention_days.load(Ordering::Relaxed));
        let result = store::cleanup(&self.conn, now_ms() - days * DAY_MS)
            .map(|_| ())
            .map_err(|e| e.to_string());
        self.report(result);
    }

    fn run(mut self, rx: Receiver<Msg>) {
        self.cleanup();
        let mut last_flush = Instant::now();
        let mut last_cleanup = Instant::now();
        loop {
            let wait = FLUSH_AFTER.saturating_sub(last_flush.elapsed());
            match rx.recv_timeout(wait) {
                Ok(Msg::Record(r, v)) => {
                    self.records.push(r);
                    self.volumes.extend(v);
                    if self.records.len() >= MAX_BATCH {
                        self.flush();
                        last_flush = Instant::now();
                    }
                }
                Ok(Msg::Cleanup) => {
                    self.flush();
                    self.cleanup();
                }
                Ok(Msg::Clear(reply)) => {
                    self.records.clear();
                    self.volumes.clear();
                    let r = store::clear(&self.conn).map_err(|e| e.to_string());
                    let _ = reply.send(r);
                    (self.on_commit)();
                }
                Ok(Msg::Flush(reply)) => {
                    self.flush();
                    last_flush = Instant::now();
                    let _ = reply.send(());
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.flush();
                    last_flush = Instant::now();
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.flush(); // final commit on shutdown
                    return;
                }
            }
            if last_cleanup.elapsed() >= CLEANUP_EVERY {
                self.cleanup();
                last_cleanup = Instant::now();
            }
        }
    }
}

pub struct HistoryWriter {
    tx: Mutex<Option<SyncSender<Msg>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl HistoryWriter {
    pub fn spawn(
        conn: Connection,
        retention_days: Arc<AtomicU32>,
        on_commit: impl Fn() + Send + 'static,
    ) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::sync_channel(CHANNEL_CAPACITY);
        let last_error = Arc::new(Mutex::new(None));
        let worker = Worker {
            conn,
            retention_days,
            records: Vec::with_capacity(MAX_BATCH),
            volumes: Vec::new(),
            last_error: Arc::clone(&last_error),
            on_commit: Box::new(on_commit),
        };
        let thread = std::thread::Builder::new()
            .name("enginemonitor-history".into())
            .spawn(move || worker.run(rx))?;
        Ok(Self {
            tx: Mutex::new(Some(tx)),
            thread: Mutex::new(Some(thread)),
            last_error,
        })
    }

    /// A sender for the sampler thread.
    pub fn sender(&self) -> Option<SyncSender<Msg>> {
        self.tx
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn send(&self, msg: Msg) -> Result<(), String> {
        match self.sender() {
            Some(tx) => tx
                .send(msg)
                .map_err(|_| "history writer has stopped".to_owned()),
            None => Err("history writer has stopped".to_owned()),
        }
    }

    pub fn request_cleanup(&self) -> Result<(), String> {
        self.send(Msg::Cleanup)
    }

    pub fn clear(&self) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.send(Msg::Clear(reply))?;
        rx.recv_timeout(Duration::from_secs(30))
            .map_err(|_| "history writer did not respond".to_owned())?
    }

    pub fn flush(&self) -> Result<(), String> {
        let (reply, rx) = mpsc::channel();
        self.send(Msg::Flush(reply))?;
        rx.recv_timeout(Duration::from_secs(30))
            .map_err(|_| "history writer did not respond".to_owned())
    }

    /// Commits pending rows and stops the thread. Idempotent. Note that
    /// other `sender()` clones (the sampler's) must be dropped too before the
    /// thread can see the disconnect; stop the sampler first.
    pub fn shutdown(&self) {
        drop(
            self.tx
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take(),
        );
        if let Some(handle) = self
            .thread
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            if handle.join().is_err() {
                eprintln!("EngineMonitor: history writer thread panicked");
            }
        }
    }
}

impl Drop for HistoryWriter {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Non-blocking hand-off from the sampler thread. Returns false if the
/// record was dropped (writer saturated or stopped).
pub fn try_record(tx: &SyncSender<Msg>, record: HistoryRecord, volumes: Vec<VolumeRecord>) -> bool {
    match tx.try_send(Msg::Record(record, volumes)) {
        Ok(()) => true,
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::schema::open;
    use crate::history::schema::tests::TempDb;
    use std::sync::atomic::AtomicUsize;

    fn rec(ts: i64) -> HistoryRecord {
        HistoryRecord {
            ts_ms: ts,
            cpu: Some(1.0),
            ..Default::default()
        }
    }

    #[test]
    fn batches_flushes_and_commits_on_shutdown() {
        let db = TempDb::new("writer");
        let commits = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&commits);
        let w = HistoryWriter::spawn(
            open(&db.0).unwrap(),
            Arc::new(AtomicU32::new(365)),
            move || {
                c.fetch_add(1, Ordering::SeqCst);
            },
        )
        .unwrap();
        let tx = w.sender().unwrap();
        let now = now_ms();
        for i in 0..MAX_BATCH as i64 {
            assert!(try_record(&tx, rec(now + i), vec![]));
        }
        w.flush().unwrap();
        assert!(commits.load(Ordering::SeqCst) >= 1);

        // Pending rows are committed on shutdown.
        assert!(try_record(&tx, rec(now + 100), vec![]));
        drop(tx);
        w.shutdown();
        let reader = open(&db.0).unwrap();
        assert_eq!(store::stats(&reader, 0).unwrap().rows, MAX_BATCH as i64 + 1);
    }

    #[test]
    fn startup_cleanup_applies_retention() {
        let db = TempDb::new("retention");
        let mut conn = open(&db.0).unwrap();
        let now = now_ms();
        store::insert_batch(&mut conn, &[rec(now - 3 * DAY_MS), rec(now - 1_000)], &[]).unwrap();
        let w = HistoryWriter::spawn(conn, Arc::new(AtomicU32::new(2)), || {}).unwrap();
        w.flush().unwrap(); // cleanup ran before the first message
        let reader = open(&db.0).unwrap();
        assert_eq!(store::stats(&reader, 0).unwrap().rows, 1);
        drop(w);
    }

    #[test]
    fn clear_removes_everything_and_drops_pending() {
        let db = TempDb::new("clear");
        let w =
            HistoryWriter::spawn(open(&db.0).unwrap(), Arc::new(AtomicU32::new(7)), || {}).unwrap();
        let tx = w.sender().unwrap();
        try_record(&tx, rec(now_ms()), vec![]);
        w.flush().unwrap();
        try_record(&tx, rec(now_ms() + 1), vec![]);
        w.clear().unwrap();
        w.flush().unwrap();
        let reader = open(&db.0).unwrap();
        assert_eq!(store::stats(&reader, 0).unwrap().rows, 0);
        drop(tx);
    }

    #[test]
    fn write_failure_is_reported_not_fatal() {
        let db = TempDb::new("readonly");
        let conn = open(&db.0).unwrap();
        // Make writes fail: a trigger that aborts every insert.
        conn.execute_batch(
            "CREATE TRIGGER fail BEFORE INSERT ON samples BEGIN SELECT RAISE(ABORT, 'disk full (simulated)'); END;",
        )
        .unwrap();
        let w = HistoryWriter::spawn(conn, Arc::new(AtomicU32::new(7)), || {}).unwrap();
        let tx = w.sender().unwrap();
        try_record(&tx, rec(now_ms()), vec![]);
        w.flush().unwrap();
        assert!(w.last_error().unwrap().contains("disk full"));
        // The writer is still alive and accepts further work.
        assert!(w.flush().is_ok());
        drop(tx);
    }
}
