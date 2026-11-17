//! EngineMonitor backend.
//!
//! Module layout (see ARCHITECTURE.md). Monitoring modules are added
//! milestone by milestone; only implemented modules are declared here.

pub mod commands;
pub mod cpu;
pub mod error;
pub mod events;
pub mod gpu;
pub mod history;
pub mod memory;
pub mod network;
pub mod processes;
pub mod rate;
pub mod reading;
pub mod settings;
pub mod storage;
pub mod system;

use tauri::{App, Builder, Manager, Runtime};

/// Tells the sampler whether the main window can be seen, from the window's
/// actual state. Called on every resize (minimise/restore arrive as resizes)
/// and once at start-up: a window minimised before it was ever shown emits no
/// resize, so start-up must sync explicitly or the throttle would not engage.
fn sync_window_visibility<R: Runtime>(window: &tauri::Window<R>) {
    if window.label() != events::MAIN_WINDOW {
        return;
    }
    let visible = window.is_visible().unwrap_or(true) && !window.is_minimized().unwrap_or(false);
    if let Some(monitor) = window.try_state::<events::MonitorState>() {
        monitor.set_window_visible(visible);
    }
}

/// Registers EngineMonitor's commands on a builder.
///
/// Shared by the real application and the integration tests (which use
/// Tauri's mock runtime), so tests exercise the exact production wiring.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        // Used only from Rust via our own commands; its JS commands are not
        // granted in the capability and therefore unreachable from the UI.
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .on_window_event(|window, event| {
            // Minimising/restoring arrives as a resize. Track it in the
            // backend (not via the WebView's visibilitychange, whose
            // behaviour on minimise differs between platforms/WebViews).
            if let tauri::WindowEvent::Resized(_) = event {
                sync_window_visibility(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::system_info,
            commands::latest_snapshot,
            commands::set_process_monitoring,
            commands::terminate_process,
            commands::history_settings,
            commands::set_history_settings,
            commands::query_history,
            commands::history_status,
            commands::clear_history,
            commands::app_settings,
            commands::set_app_settings,
            commands::set_window_visible,
            commands::launch_at_login,
            commands::set_launch_at_login,
        ])
}

/// Starts monitoring on a built app, storing history in the platform's
/// application data directory.
///
/// Called between `build()` and `run()` rather than from a `setup` hook,
/// because `setup` only runs once the event loop starts, which the
/// integration tests (mock runtime) never do. Events emitted before the
/// window has loaded are not delivered; the frontend fetches
/// `latest_snapshot` on start to cover that gap.
pub fn init<R: Runtime>(app: &App<R>) {
    let data_dir = match app.path().app_data_dir() {
        Ok(dir) => Some(dir),
        Err(e) => {
            eprintln!("EngineMonitor: no app data directory: {e}");
            None
        }
    };
    init_with_data_dir(app, data_dir);
}

/// Like [`init`] with an explicit data directory (tests use a temp dir so
/// they never touch the user's real history).
pub fn init_with_data_dir<R: Runtime>(app: &App<R>, data_dir: Option<std::path::PathBuf>) {
    app.manage(events::MonitorState::start(app.handle(), data_dir));
}

/// Stops sampling and commits pending history (also used by tests that
/// re-open the same data directory).
pub fn shutdown<R: Runtime>(app: &App<R>) {
    if let Some(monitor) = app.try_state::<events::MonitorState>() {
        monitor.stop();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = configure(tauri::Builder::default())
        .build(tauri::generate_context!())
        .expect("error while building EngineMonitor");
    init(&app);
    app.run(|app, event| match event {
        // Config windows exist only once the event loop is ready.
        tauri::RunEvent::Ready => {
            let start_minimized = app
                .try_state::<events::MonitorState>()
                .is_some_and(|m| m.app_settings().start_minimized);
            if let Some(window) = app.get_webview_window(events::MAIN_WINDOW) {
                if start_minimized {
                    if let Err(e) = window.minimize() {
                        eprintln!("EngineMonitor: could not start minimised: {e}");
                    }
                }
                sync_window_visibility(&window.as_ref().window());
            }
        }
        tauri::RunEvent::Exit => {
            // Join the sampler thread and commit pending history.
            if let Some(monitor) = app.try_state::<events::MonitorState>() {
                monitor.stop();
            }
        }
        _ => {}
    });
}
