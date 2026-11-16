//! EngineMonitor backend.
//!
//! Module layout (see ARCHITECTURE.md). Monitoring modules are added
//! milestone by milestone; only implemented modules are declared here.

pub mod commands;
pub mod cpu;
pub mod error;
pub mod events;
pub mod memory;
pub mod network;
pub mod rate;
pub mod reading;
pub mod storage;
pub mod system;

use tauri::{App, Builder, Manager, Runtime};

/// Registers EngineMonitor's commands on a builder.
///
/// Shared by the real application and the integration tests (which use
/// Tauri's mock runtime), so tests exercise the exact production wiring.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::app_info,
        commands::system_info,
        commands::latest_snapshot,
    ])
}

/// Starts monitoring on a built app. Called between `build()` and `run()`
/// rather than from a `setup` hook, because `setup` only runs once the event
/// loop starts, which the integration tests (mock runtime) never do.
/// Events emitted before the window has loaded are simply not delivered;
/// the frontend fetches `latest_snapshot` on start to cover that gap.
pub fn init<R: Runtime>(app: &App<R>) {
    app.manage(events::MonitorState::start(app.handle()));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = configure(tauri::Builder::default())
        .build(tauri::generate_context!())
        .expect("error while building EngineMonitor");
    init(&app);
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            // Join the sampler thread so no tick runs during teardown.
            if let Some(monitor) = app.try_state::<events::MonitorState>() {
                monitor.stop();
            }
        }
    });
}
