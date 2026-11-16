//! Tauri command handlers.
//!
//! Handlers stay thin: validate input, delegate to a module, map errors.
//! Each command must also be listed in `build.rs` and granted in
//! `capabilities/default.json`, otherwise the frontend cannot call it.

use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::events::{MonitorState, SnapshotEvent};
use crate::history::{HistoryQuery, HistoryStatus};
use crate::settings::HistorySettings;
use crate::system::SystemInfo;

/// Static information about the running build. Contains no user data.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub target_os: String,
    pub target_arch: String,
    pub debug_build: bool,
}

impl AppInfo {
    pub fn current() -> Self {
        Self {
            name: "EngineMonitor".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            tauri_version: tauri::VERSION.to_owned(),
            target_os: std::env::consts::OS.to_owned(),
            target_arch: std::env::consts::ARCH.to_owned(),
            debug_build: cfg!(debug_assertions),
        }
    }
}

#[tauri::command]
pub fn app_info() -> AppResult<AppInfo> {
    Ok(AppInfo::current())
}

/// Static machine description (OS, CPU model, installed memory).
#[tauri::command]
pub fn system_info(state: State<'_, MonitorState>) -> AppResult<SystemInfo> {
    state.system_info()
}

/// Turns the process list in snapshot events on or off. The Processes page
/// enables it while open; collecting it costs noticeably more than the rest.
#[tauri::command]
pub fn set_process_monitoring(state: State<'_, MonitorState>, enabled: bool) -> AppResult<()> {
    state.system_info()?;
    state.set_process_monitoring(enabled);
    Ok(())
}

/// Ends a process after the user confirmed it in the UI. `start_time_secs`
/// must match the process shown in the confirmation, which guards against a
/// PID having been reused in between.
#[tauri::command]
pub fn terminate_process(pid: u32, start_time_secs: u64) -> AppResult<()> {
    if pid == 0 {
        return Err(AppError::InvalidArgument(
            "PID must be greater than 0".into(),
        ));
    }
    crate::processes::terminate::terminate(pid, start_time_secs)
}

#[tauri::command]
pub fn history_settings(state: State<'_, MonitorState>) -> AppResult<HistorySettings> {
    Ok(state.history()?.settings())
}

/// Validates and persists new history settings. Shortening retention deletes
/// older rows right away.
#[tauri::command]
pub fn set_history_settings(
    state: State<'_, MonitorState>,
    settings: HistorySettings,
) -> AppResult<HistorySettings> {
    state.history()?.set_settings(settings)
}

/// Bucketed history for `[from_ms, to_ms)`, at most `max_points` points.
#[tauri::command]
pub fn query_history(
    state: State<'_, MonitorState>,
    from_ms: i64,
    to_ms: i64,
    max_points: u32,
) -> AppResult<HistoryQuery> {
    state.history()?.query(from_ms, to_ms, max_points)
}

#[tauri::command]
pub fn history_status(state: State<'_, MonitorState>) -> AppResult<HistoryStatus> {
    state.history()?.status()
}

/// Deletes all recorded history. The UI asks for confirmation first.
#[tauri::command]
pub fn clear_history(state: State<'_, MonitorState>) -> AppResult<()> {
    state.history()?.clear()
}

/// Most recent sample, so a page can render before the next event arrives.
/// `None` until the first tick has completed.
#[tauri::command]
pub fn latest_snapshot(state: State<'_, MonitorState>) -> AppResult<Option<SnapshotEvent>> {
    state.latest()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reflects_build() {
        let info = app_info().unwrap();
        assert_eq!(info.name, "EngineMonitor");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.target_os, std::env::consts::OS);
        assert!(!info.tauri_version.is_empty());
    }

    #[test]
    fn app_info_serialises_camel_case() {
        let json = serde_json::to_value(AppInfo::current()).unwrap();
        assert!(json.get("tauriVersion").is_some());
        assert!(json.get("targetOs").is_some());
        assert!(json.get("debugBuild").is_some());
    }
}
