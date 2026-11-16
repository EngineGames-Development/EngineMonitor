//! EngineMonitor backend.
//!
//! Module layout (see ARCHITECTURE.md). Monitoring modules are added
//! milestone by milestone; only implemented modules are declared here.

pub mod commands;
pub mod cpu;
pub mod error;
pub mod memory;
pub mod network;
pub mod rate;
pub mod reading;
pub mod storage;
pub mod system;

use tauri::{Builder, Runtime};

/// Registers EngineMonitor's commands and state on a builder.
///
/// Shared by the real application and the integration tests (which use
/// Tauri's mock runtime), so tests exercise the exact production wiring.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![commands::app_info])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("error while running EngineMonitor");
}
