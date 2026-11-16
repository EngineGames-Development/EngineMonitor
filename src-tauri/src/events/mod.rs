//! Real-time delivery of measurements to the frontend.
//!
//! One sampler thread owns the `SystemCollector` and emits a
//! [`SnapshotEvent`] on [`SNAPSHOT_EVENT`] to the main window every tick. The
//! frontend subscribes once and never polls. `latest_snapshot` exists only so
//! a freshly loaded page can render immediately instead of waiting for the
//! next tick.

pub mod sampler;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppResult};
use crate::system::{Snapshot, SystemCollector, SystemInfo};
use sampler::{Sampler, DEFAULT_INTERVAL};

pub const SNAPSHOT_EVENT: &str = "metrics://snapshot";
pub const MAIN_WINDOW: &str = "main";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEvent {
    /// Increments by one per tick; a gap means the frontend missed events.
    pub sequence: u64,
    /// The sampling interval in effect, so the UI can detect stale data.
    pub interval_ms: u64,
    pub snapshot: Snapshot,
}

/// Managed Tauri state for monitoring.
pub struct MonitorState {
    info: Result<SystemInfo, AppError>,
    sampler: Option<Sampler<SnapshotEvent>>,
}

impl MonitorState {
    /// Initialises collectors and starts the sampler. Never fails: if
    /// collectors cannot be initialised, the error is kept and returned by the
    /// commands so the UI can show it.
    pub fn start<R: Runtime>(app: &AppHandle<R>) -> Self {
        let mut collector = match SystemCollector::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("EngineMonitor: collectors unavailable: {e}");
                return Self {
                    info: Err(e),
                    sampler: None,
                };
            }
        };
        let info = collector.info();

        let interval_ms = Arc::new(AtomicU64::new(DEFAULT_INTERVAL.as_millis() as u64));
        let sequence = AtomicU64::new(0);
        let source_interval = Arc::clone(&interval_ms);
        let source = move || SnapshotEvent {
            sequence: sequence.fetch_add(1, Ordering::Relaxed),
            interval_ms: source_interval.load(Ordering::Relaxed),
            snapshot: collector.sample(),
        };

        let handle = app.clone();
        let emit_error_logged = AtomicBool::new(false);
        let sink = move |event: &SnapshotEvent| {
            if let Err(e) = handle.emit_to(MAIN_WINDOW, SNAPSHOT_EVENT, event) {
                // Log once per failure streak instead of every tick.
                if !emit_error_logged.swap(true, Ordering::Relaxed) {
                    eprintln!("EngineMonitor: failed to emit snapshot: {e}");
                }
            } else {
                emit_error_logged.store(false, Ordering::Relaxed);
            }
        };

        match Sampler::spawn(
            "enginemonitor-sampler",
            Duration::from_millis(interval_ms.load(Ordering::Relaxed)),
            source,
            sink,
        ) {
            Ok(sampler) => Self {
                info: Ok(info),
                sampler: Some(sampler),
            },
            Err(e) => Self {
                info: Err(AppError::Internal(format!(
                    "failed to start the sampler thread: {e}"
                ))),
                sampler: None,
            },
        }
    }

    pub fn system_info(&self) -> AppResult<SystemInfo> {
        self.info.clone()
    }

    pub fn latest(&self) -> AppResult<Option<SnapshotEvent>> {
        match (&self.info, &self.sampler) {
            (Err(e), _) => Err(e.clone()),
            (Ok(_), Some(s)) => Ok(s.latest()),
            (Ok(_), None) => Err(AppError::Internal("sampler is not running".into())),
        }
    }

    pub fn stop(&self) {
        if let Some(s) = &self.sampler {
            s.stop();
        }
    }
}
