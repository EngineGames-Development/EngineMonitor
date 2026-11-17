//! Real-time delivery of measurements to the frontend.
//!
//! One sampler thread owns the `SystemCollector` and emits a
//! [`SnapshotEvent`] on [`SNAPSHOT_EVENT`] to the main window every tick. The
//! frontend subscribes once and never polls. `latest_snapshot` exists only so
//! a freshly loaded page can render immediately instead of waiting for the
//! next tick.
//!
//! The same thread feeds the history [`Recorder`](crate::history::Recorder);
//! the history writer emits [`HISTORY_UPDATED_EVENT`] after each commit so the
//! History page can refresh without polling.

pub mod sampler;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{AppError, AppResult};
use crate::gpu::GpuMonitor;
use crate::history::{History, DB_FILE_NAME};
use crate::processes::ProcessList;
use crate::settings::app::{self as app_settings, AppSettings};
use crate::system::{Snapshot, SystemCollector, SystemInfo};
use sampler::Sampler;

pub const SNAPSHOT_EVENT: &str = "metrics://snapshot";
pub const HISTORY_UPDATED_EVENT: &str = "history://updated";
pub const MAIN_WINDOW: &str = "main";
/// Slowest-allowed live interval while the window is hidden or minimised.
/// Nobody is looking, so sampling only needs to keep history meaningful.
pub const HIDDEN_INTERVAL_MS: u32 = 5_000;

/// Interval to use given the user's setting and window visibility.
pub fn effective_interval_ms(configured_ms: u32, visible: bool) -> u32 {
    if visible {
        configured_ms
    } else {
        configured_ms.max(HIDDEN_INTERVAL_MS)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEvent {
    /// Increments by one per tick; a gap means the frontend missed events.
    pub sequence: u64,
    /// The sampling interval in effect, so the UI can detect stale data.
    pub interval_ms: u64,
    pub snapshot: Snapshot,
    /// Present only while process monitoring is enabled.
    pub processes: Option<ProcessList>,
}

/// Managed Tauri state for monitoring.
pub struct MonitorState {
    info: Result<SystemInfo, AppError>,
    sampler: Option<Sampler<SnapshotEvent>>,
    process_stream: Arc<AtomicBool>,
    history: Result<History, AppError>,
    settings: Mutex<AppSettings>,
    interval_ms: Arc<AtomicU64>,
    window_visible: Arc<AtomicBool>,
}

fn open_history<R: Runtime>(
    app: &AppHandle<R>,
    data_dir: Option<PathBuf>,
) -> Result<History, AppError> {
    let dir = data_dir.ok_or_else(|| {
        AppError::Unsupported(
            "no application data directory is available; history cannot be stored".into(),
        )
    })?;
    let handle = app.clone();
    History::open(dir.join(DB_FILE_NAME), move || {
        // Payload-free notification; listeners re-query what they display.
        let _ = handle.emit_to(MAIN_WINDOW, HISTORY_UPDATED_EVENT, ());
    })
}

impl MonitorState {
    /// Initialises collectors and history and starts the sampler. Never
    /// fails: errors are kept and returned by the commands so the UI can show
    /// them. History failing (e.g. unwritable data directory) does not stop
    /// live monitoring.
    pub fn start<R: Runtime>(app: &AppHandle<R>, data_dir: Option<PathBuf>) -> Self {
        let history = open_history(app, data_dir);
        if let Err(e) = &history {
            eprintln!("EngineMonitor: history unavailable: {e}");
        }
        let settings = history
            .as_ref()
            .map(|h| h.with_db(app_settings::load))
            .unwrap_or_default();
        let interval_ms = Arc::new(AtomicU64::new(u64::from(settings.refresh_interval_ms)));
        let window_visible = Arc::new(AtomicBool::new(true));

        let mut collector = match SystemCollector::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("EngineMonitor: collectors unavailable: {e}");
                return Self {
                    info: Err(e),
                    sampler: None,
                    process_stream: Arc::new(AtomicBool::new(false)),
                    history,
                    settings: Mutex::new(settings),
                    interval_ms,
                    window_visible,
                };
            }
        };
        let info = collector.info();

        let sequence = AtomicU64::new(0);
        let source_interval = Arc::clone(&interval_ms);
        let process_stream = Arc::new(AtomicBool::new(false));
        let source_processes = Arc::clone(&process_stream);
        let source_visible = Arc::clone(&window_visible);
        let mut recorder = history.as_ref().ok().and_then(History::recorder);

        // Built on the sampler thread: GPU providers may hold OS handles that
        // must not cross threads.
        let make_source = move || {
            let mut gpu = GpuMonitor::new();
            let mut processes_were_on = false;
            move || {
                let snapshot = collector.sample(&mut gpu);
                if let Some(r) = recorder.as_mut() {
                    r.observe(&snapshot);
                }
                // No process list while the window is hidden: nobody sees it.
                let processes_on = source_processes.load(Ordering::Relaxed)
                    && source_visible.load(Ordering::Relaxed);
                if processes_on && !processes_were_on {
                    collector.reset_processes();
                }
                processes_were_on = processes_on;
                SnapshotEvent {
                    sequence: sequence.fetch_add(1, Ordering::Relaxed),
                    interval_ms: source_interval.load(Ordering::Relaxed),
                    processes: processes_on.then(|| collector.sample_processes()),
                    snapshot,
                }
            }
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

        match Sampler::spawn_with(
            "enginemonitor-sampler",
            Duration::from_millis(interval_ms.load(Ordering::Relaxed)),
            make_source,
            sink,
        ) {
            Ok(sampler) => Self {
                info: Ok(info),
                sampler: Some(sampler),
                process_stream,
                history,
                settings: Mutex::new(settings),
                interval_ms,
                window_visible,
            },
            Err(e) => Self {
                info: Err(AppError::Internal(format!(
                    "failed to start the sampler thread: {e}"
                ))),
                sampler: None,
                process_stream,
                history,
                settings: Mutex::new(settings),
                interval_ms,
                window_visible,
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

    /// Enables or disables the process list in snapshot events.
    pub fn set_process_monitoring(&self, enabled: bool) {
        self.process_stream.store(enabled, Ordering::Relaxed);
    }

    pub fn app_settings(&self) -> AppSettings {
        *self.settings.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Validates, persists and applies new settings. Nothing is applied if
    /// saving fails, so the UI never shows settings that will not survive a
    /// restart.
    pub fn set_app_settings(&self, s: AppSettings) -> AppResult<AppSettings> {
        s.validate()?;
        let history = self.history().map_err(|e| {
            AppError::Unsupported(format!(
                "settings cannot be saved because storage is unavailable: {e}"
            ))
        })?;
        history.with_db(|c| app_settings::save(c, &s))?;
        *self.settings.lock().unwrap_or_else(PoisonError::into_inner) = s;
        self.apply_interval();
        Ok(s)
    }

    /// Called by the frontend when the window is hidden/minimised or shown.
    pub fn set_window_visible(&self, visible: bool) {
        self.window_visible.store(visible, Ordering::Relaxed);
        self.apply_interval();
    }

    /// Interval currently in effect (ms).
    pub fn current_interval_ms(&self) -> u64 {
        self.interval_ms.load(Ordering::Relaxed)
    }

    fn apply_interval(&self) {
        let ms = effective_interval_ms(
            self.app_settings().refresh_interval_ms,
            self.window_visible.load(Ordering::Relaxed),
        );
        if let Some(s) = &self.sampler {
            let effective = s.set_interval(Duration::from_millis(u64::from(ms)));
            self.interval_ms
                .store(effective.as_millis() as u64, Ordering::Relaxed);
        }
    }

    pub fn history(&self) -> AppResult<&History> {
        self.history.as_ref().map_err(Clone::clone)
    }

    /// Stops sampling, then commits pending history. Order matters: the
    /// sampler thread holds a history sender until it exits.
    pub fn stop(&self) {
        if let Some(s) = &self.sampler {
            s.stop();
        }
        if let Ok(h) = &self.history {
            h.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_window_never_samples_faster_than_five_seconds() {
        assert_eq!(effective_interval_ms(1_000, true), 1_000);
        assert_eq!(effective_interval_ms(1_000, false), HIDDEN_INTERVAL_MS);
        // A user setting slower than the hidden floor is kept.
        assert_eq!(effective_interval_ms(10_000, false), 10_000);
    }
}
