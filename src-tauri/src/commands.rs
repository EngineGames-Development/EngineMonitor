//! Tauri command handlers.
//!
//! Handlers stay thin: validate input, delegate to a module, map errors.
//! Each command must also be listed in `build.rs` and granted in
//! `capabilities/default.json`, otherwise the frontend cannot call it.

use serde::Serialize;

use crate::error::AppResult;

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
