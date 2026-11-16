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
    enginemonitor_lib::init_with_data_dir(&app, Some(temp_data_dir()));
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build main window");
    (app, webview)
}

/// A fresh directory per test app so tests never touch real user history.
/// Left in the OS temp dir (cleaned by the OS); each is a few KB.
fn temp_data_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    std::env::temp_dir().join(format!(
        "enginemonitor-ipc-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ))
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

fn request_with(cmd: &str, body: Value) -> InvokeRequest {
    InvokeRequest {
        body: InvokeBody::Json(body),
        ..request(cmd)
    }
}

#[test]
fn process_list_is_only_streamed_while_enabled() {
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Listener;

    let (app, webview) = app();
    let (tx, rx) = mpsc::channel::<Value>();
    app.listen_any(enginemonitor_lib::events::SNAPSHOT_EVENT, move |event| {
        let _ = tx.send(serde_json::from_str(event.payload()).unwrap());
    });

    let first = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(first["processes"].is_null(), "off by default");

    get_ipc_response(
        &webview,
        request_with(
            "set_process_monitoring",
            serde_json::json!({ "enabled": true }),
        ),
    )
    .expect("enable");
    let with = loop {
        let e = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        if !e["processes"].is_null() {
            break e;
        }
    };
    let own_pid = with["processes"]["ownPid"].as_u64().unwrap();
    assert!(with["processes"]["processes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["pid"].as_u64() == Some(own_pid)));

    get_ipc_response(
        &webview,
        request_with(
            "set_process_monitoring",
            serde_json::json!({ "enabled": false }),
        ),
    )
    .expect("disable");
    // At most one in-flight tick may still carry processes.
    let mut saw_off = false;
    for _ in 0..3 {
        if rx.recv_timeout(Duration::from_secs(5)).unwrap()["processes"].is_null() {
            saw_off = true;
            break;
        }
    }
    assert!(saw_off);
}

#[test]
fn terminate_process_validates_input_and_refuses_self() {
    let (_app, webview) = app();
    // Wrong argument type is rejected by deserialisation.
    assert!(get_ipc_response(
        &webview,
        request_with(
            "terminate_process",
            serde_json::json!({ "pid": "1", "startTimeSecs": 0 })
        )
    )
    .is_err());
    // Self-termination is refused with a typed error.
    let err = get_ipc_response(
        &webview,
        request_with(
            "terminate_process",
            serde_json::json!({ "pid": std::process::id(), "startTimeSecs": 0 }),
        ),
    )
    .expect_err("must refuse self");
    assert_eq!(err["kind"], "invalid_argument");
}

#[test]
fn history_settings_roundtrip_and_validation() {
    let (_app, webview) = app();
    let defaults: Value = get_ipc_response(&webview, request("history_settings"))
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(defaults["intervalSecs"], 5);
    assert_eq!(defaults["retentionDays"], 7);

    let bad = get_ipc_response(
        &webview,
        request_with(
            "set_history_settings",
            serde_json::json!({ "settings": { "enabled": true, "intervalSecs": 0, "retentionDays": 7 } }),
        ),
    )
    .expect_err("interval 0 must be rejected");
    assert_eq!(bad["kind"], "invalid_argument");

    let unknown_field = get_ipc_response(
        &webview,
        request_with(
            "set_history_settings",
            serde_json::json!({ "settings": { "enabled": true, "intervalSecs": 5, "retentionDays": 7, "path": "C:/" } }),
        ),
    );
    assert!(unknown_field.is_err(), "unknown fields are rejected");

    get_ipc_response(
        &webview,
        request_with(
            "set_history_settings",
            serde_json::json!({ "settings": { "enabled": true, "intervalSecs": 30, "retentionDays": 90 } }),
        ),
    )
    .expect("valid settings");
    let now: Value = get_ipc_response(&webview, request("history_settings"))
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(now["intervalSecs"], 30);
}

#[test]
fn query_history_validates_range() {
    let (_app, webview) = app();
    let err = get_ipc_response(
        &webview,
        request_with(
            "query_history",
            serde_json::json!({ "fromMs": 10, "toMs": 5, "maxPoints": 100 }),
        ),
    )
    .expect_err("reversed range");
    assert_eq!(err["kind"], "invalid_argument");
}

#[test]
fn records_history_end_to_end_and_notifies() {
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tauri::Listener;

    let (app, webview) = app();
    let (tx, rx) = mpsc::channel::<()>();
    app.listen_any(
        enginemonitor_lib::events::HISTORY_UPDATED_EVENT,
        move |_| {
            let _ = tx.send(());
        },
    );
    // 1 s windows: the writer commits after 6 records (~7 s).
    get_ipc_response(
        &webview,
        request_with(
            "set_history_settings",
            serde_json::json!({ "settings": { "enabled": true, "intervalSecs": 1, "retentionDays": 7 } }),
        ),
    )
    .unwrap();
    rx.recv_timeout(Duration::from_secs(20))
        .expect("history://updated after the first committed batch");

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let q: Value = get_ipc_response(
        &webview,
        request_with(
            "query_history",
            serde_json::json!({ "fromMs": now - 60_000, "toMs": now + 1_000, "maxPoints": 120 }),
        ),
    )
    .unwrap()
    .deserialize()
    .unwrap();
    let points = q["points"].as_array().unwrap();
    assert!(points.len() >= 5, "got {} points", points.len());
    assert!(points
        .iter()
        .any(|p| p["memory"].as_f64().unwrap_or(0.0) > 0.0));

    let status: Value = get_ipc_response(&webview, request("history_status"))
        .unwrap()
        .deserialize()
        .unwrap();
    assert!(status["stats"]["rows"].as_i64().unwrap() >= 5);
    assert!(status["stats"]["sizeBytes"].as_u64().unwrap() > 0);
    assert!(status["lastError"].is_null());

    get_ipc_response(&webview, request("clear_history")).expect("clear");
    let status: Value = get_ipc_response(&webview, request("history_status"))
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(status["stats"]["rows"], 0);
}

#[test]
fn history_failure_does_not_stop_live_monitoring() {
    use std::time::Duration;
    use tauri::Listener;

    let app = enginemonitor_lib::configure(mock_builder())
        .build(tauri::generate_context!())
        .unwrap();
    // A data "directory" that is actually a file: history cannot open.
    let blocker = temp_data_dir();
    std::fs::write(&blocker, b"not a directory").unwrap();
    enginemonitor_lib::init_with_data_dir(&app, Some(blocker.clone()));
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let err =
        get_ipc_response(&webview, request("history_status")).expect_err("history unavailable");
    assert_eq!(err["kind"], "internal");

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    app.listen_any(enginemonitor_lib::events::SNAPSHOT_EVENT, move |_| {
        let _ = tx.send(());
    });
    rx.recv_timeout(Duration::from_secs(5))
        .expect("snapshots still flow");
    let _ = std::fs::remove_file(blocker);
}
