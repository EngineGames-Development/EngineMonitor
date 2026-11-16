//! Backend integration tests: drive commands through Tauri's real IPC layer
//! (mock runtime) with the production configuration, capabilities and
//! command allow-list.

use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

fn app() -> (
    App<tauri::test::MockRuntime>,
    WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = enginemonitor_lib::configure(mock_builder())
        .build(tauri::generate_context!())
        .expect("failed to build app");
    enginemonitor_lib::init(&app);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build main window");
    (app, webview)
}

fn request(cmd: &str) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: InvokeBody::default(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

#[test]
fn app_info_is_callable_from_main_window() {
    let (_app, webview) = app();
    let res = get_ipc_response(&webview, request("app_info")).expect("app_info should succeed");
    let info: Value = res.deserialize().unwrap();
    assert_eq!(info["name"], "EngineMonitor");
    assert_eq!(info["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(info["targetOs"], std::env::consts::OS);
}

#[test]
fn unknown_commands_are_rejected() {
    let (_app, webview) = app();
    let res = get_ipc_response(&webview, request("definitely_not_a_command"));
    assert!(res.is_err(), "unregistered command must not succeed");
}

#[test]
fn plugin_commands_are_not_exposed() {
    // No fs/shell plugins are installed; their commands must be unreachable.
    let (_app, webview) = app();
    assert!(get_ipc_response(&webview, request("plugin:fs|read_file")).is_err());
    assert!(get_ipc_response(&webview, request("plugin:shell|execute")).is_err());
}

#[test]
fn commands_are_denied_for_windows_without_capability() {
    // Capabilities are scoped to the "main" window label; any other window
    // (e.g. one opened by injected script) must not reach app commands.
    let (app, _main) = app();
    let other = WebviewWindowBuilder::new(&app, "untrusted", Default::default())
        .build()
        .unwrap();
    let res = get_ipc_response(&other, request("app_info"));
    let err = res.expect_err("window without capability must be denied");
    assert!(
        err.to_string().contains("not allowed"),
        "unexpected error: {err}"
    );
}

#[test]
fn system_info_returns_real_machine_data() {
    let (_app, webview) = app();
    let res = get_ipc_response(&webview, request("system_info")).expect("system_info");
    let info: Value = res.deserialize().unwrap();
    assert!(info["cpu"]["logicalCores"].as_u64().unwrap() > 0);
    assert!(info["totalMemoryBytes"].as_u64().unwrap() > 0);
}

#[test]
fn sampler_emits_snapshot_events_and_exposes_latest() {
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Listener;

    let (app, webview) = app();
    let (tx, rx) = mpsc::channel::<String>();
    app.listen_any(enginemonitor_lib::events::SNAPSHOT_EVENT, move |event| {
        let _ = tx.send(event.payload().to_owned());
    });

    // Default interval is 1 s; two ticks prove it is periodic.
    let first: Value = serde_json::from_str(
        &rx.recv_timeout(Duration::from_secs(5))
            .expect("first event"),
    )
    .unwrap();
    let second: Value = serde_json::from_str(
        &rx.recv_timeout(Duration::from_secs(5))
            .expect("second event"),
    )
    .unwrap();
    assert_eq!(
        second["sequence"].as_u64().unwrap(),
        first["sequence"].as_u64().unwrap() + 1
    );
    assert_eq!(second["intervalMs"], 1000);
    assert!(second["snapshot"]["memory"]["totalBytes"].as_u64().unwrap() > 0);

    let res = get_ipc_response(&webview, request("latest_snapshot")).expect("latest_snapshot");
    let latest: Value = res.deserialize().unwrap();
    assert!(latest["sequence"].as_u64().unwrap() >= 1);
}
