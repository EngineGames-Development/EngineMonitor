# EngineMonitor — Development Status

Last updated: 2026-11-16 · Current milestone: **4 (Depth) — complete** · Next: 5 (SQLite history)

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ⛔ blocked

## Milestone 1 — Foundation ✅

| Item | Status | Notes |
|---|---|---|
| Repository inspection | ✅ | Folder was empty; git repo initialised on `main`. |
| Architecture & plan | ✅ | `ARCHITECTURE.md` |
| Tauri 2 initialised | ✅ | Tauri 2.12, minimal capability file, strict CSP, command allow-list in `build.rs`. Bundle identifier `dev.enginemonitor.desktop`. |
| React + TypeScript + Vite | ✅ | React 19, TypeScript 7, Vite 8, strict TS options. |
| Design system | ✅ | Tokens (`src/styles/index.css`), dark + light palettes, type scale, components in `src/design/`, in-repo icon set, app icon. |
| Navigation | ✅ | Persistent sidebar with all 9 sections; Ctrl/Cmd+1..9; auto-collapse to icon rail < 1024 px. |
| Theme switching | ✅ | Dark / Light / System; persisted in WebView `localStorage` (**interim**: moves to SQLite settings in M6). |
| First IPC command | ✅ | `app_info` (build/version data only). |

## Milestone 2 — Collectors ✅


| Item | Status | Notes |
|---|---|---|
| Rate maths (`rate.rs`) | ✅ | Counter delta ÷ measured elapsed time. First observation, counter reset, zero elapsed and vanished/re-appearing keys all yield "no rate" (`None`). |
| `Reading<T>` (`reading.rs`) | ✅ | Distinguishes unsupported vs error; maps `sysinfo::Error::Unsupported`. |
| System info (`system/`) | ✅ | OS name/version/long name, kernel, boot time, CPU info, total RAM. Hostname deliberately not collected. |
| CPU (`cpu/`) | ✅ | Overall + per-core usage (none on the first, unprimed tick), per-core frequency (0 MHz → unknown), logical/physical cores, load average as `Reading` (unsupported on Windows). |
| Memory (`memory/`) | ✅ | Total/used/available, %, swap; no swap → `null` percentage, not 0 %. |
| Storage (`storage/`) | ✅ | Volumes, FS, media kind, removable/read-only, capacity, %, read/write B/s from counters; volumes with no I/O counters → unsupported. Re-lists volumes every tick (mounts/unmounts picked up). |
| Network (`network/`) | ✅ | Interfaces, state, MAC, CIDR addresses, MTU, link speed, totals, per-interface and aggregate rx/tx B/s; loopback excluded from aggregate. |
| Aggregate collector | ✅ | `SystemCollector` owns all `sysinfo` state, `sample()` → `Snapshot`. |

### Verification performed (Windows 11 Home 26300, x64, Rust 1.96, Node 22)
- `cargo test` — **42 passing**: 34 unit, 4 IPC integration, 4 real-hardware collector tests.
- `cargo clippy --all-targets -D warnings` — 0 warnings; `cargo fmt --check` — clean.
- `npm run typecheck` clean, `npm test` 50 passing (frontend unchanged since M1; re-run 2026-11-16).
- `npx tauri build --no-bundle` — **succeeded** (12 m 37 s, LTO). Release exe 3.2 MB; launched, opened window "EngineMonitor", host process ~21.6 MB working set (WebView2 processes not included). The release build predates the M2 modules being wired into `lib.rs`; a fresh release build has not been run since.
- `cargo run --example snapshot` on the dev machine (Ryzen 3 3200G, 16 GB with 13.93 GiB visible, C: SSD, D: HDD, G: Google Drive virtual volume, Ethernet + 2 VMware adapters): all values plausible; G: correctly reported as "I/O unavailable"; Windows load average reported unsupported. One `sample()` tick took ~18 ms in a debug build.
- Values have **not** yet been compared side by side with Task Manager.

## Milestone 3 — Live data ✅

| Item | Status | Notes |
|---|---|---|
| Sampler thread (`events/sampler.rs`) | ✅ | Generic, Condvar-timed: stop and interval changes take effect immediately; cadence measured from tick start; interval clamped to 250 ms–10 s (fixed at 1 s until settings exist in M6). |
| Snapshot events | ✅ | `metrics://snapshot` to the main window with `sequence` + `intervalMs`; emit failures logged once per streak. |
| Commands | ✅ | `system_info`, `latest_snapshot` (allow-listed + capability). |
| Frontend store (`src/metrics/`) | ✅ | One subscription for the whole app; capped history (300 points); sequence gaps → chart gaps; duplicate/out-of-order events dropped; "Stale" after 3 missed intervals; listener cleaned up on unmount, including unmount during registration. |
| Charts | ✅ | `TimeSeriesChart` (Recharts): theme tokens, no animation, nulls drawn as gaps. |
| Overview dashboard | ✅ | CPU, memory, disk activity, network tiles with 1-minute sparklines; 5-minute CPU/memory and network charts; system card (OS, kernel, CPU model, cores, arch, installed memory, uptime); storage devices with capacity and I/O; GPU card shown as "Not implemented" (M4). |

### Verification performed for M3
- `cargo test` — **48 passing** (38 unit, 4 real-hardware collector, 6 IPC incl. two consecutive real snapshot events and `latest_snapshot`). clippy 0 warnings, fmt clean.
- `npm test` — **73 passing** (history/reducer/availability logic; Overview with mocked Tauri events: rendering, live updates, hydrate, unprimed "measuring" state, unsupported I/O, backend error, unsubscribe). `npm run build` succeeds (JS 187 KB gzip, was 76 KB before Recharts).
- **Real app (`npm run tauri dev`)**: Overview renders live data on the dev machine (screenshot checked). This run found and fixed a startup crash (`freezePrototype` vs Recharts, see ARCHITECTURE.md).
- **Cross-check against Windows (WMI perf classes, same moment)**: total memory identical (14,956,380,160 B); available memory within ~7 % (sampled at different instants); CPU 99.9 % vs 100 %; network rates bursty, same order of magnitude.
- **Resource use (preliminary, not a benchmark)**: dev build with React development mode, Overview open, 1 s interval — WebView2 renderer ≈ 2.6 % of total CPU (4 cores) and 116 MB working set over 20 s. The host process could not be measured because the app window was closed during the measurement. Proper release-build benchmarks are milestone 6/7.

## Milestone 4 — Depth ✅ (with gaps listed below)

| Item | Status | Notes |
|---|---|---|
| Process collection (`processes/`) | ✅ | PID, parent, name, executable path (null when the OS hides it), status, CPU % of whole machine, resident + virtual memory, disk read/write B/s, start time, run time. Keyed by (PID, start time) so reused PIDs never inherit counters. No command lines/environment collected. Only while the Processes page is open (`set_process_monitoring`). |
| Process termination | ✅ | `terminate_process(pid, startTimeSecs)`: refuses PID 0, self, session-critical processes; Windows uses `OpenProcess`/`TerminateProcess` with race-free start-time check and precise "access denied" / "not found" errors. Confirmation dialog in UI. |
| GPU provider architecture (`gpu/`) | ✅ | `GpuProvider` trait; `GpuMonitor` contains init failures, errors and panics. Windows: own DXGI + PDH provider. Linux/macOS: `sysinfo` provider (unverified). Temperature: unsupported everywhere (no vendor provider). |
| `Reading::Pending` | ✅ | For delta-based values on their first sample (GPU utilisation). |
| Processes page | ✅ | Search (name/path/exact PID), filters (All / Using CPU / Path visible), sortable columns with unknown values last, virtualised table (`useVirtualRows`), detail panel with parent link, end-process flow with confirmation, OS-error display, own process protected. |
| CPU page | ✅ | Utilisation, "Reported frequency" (labelled as Windows value), cores, load average (unsupported badge on Windows), 5-minute chart, per-core meters + frequency. |
| Memory page | ✅ | Used/available/total, swap ("No swap configured" instead of 0 %), chart, meters. |
| GPU page | ✅ | Per-adapter utilisation, dedicated VRAM, temperature (unsupported), busiest-adapter chart; explicit unsupported/error/no-GPU states. Overview GPU card now live. |
| Storage page | ✅ | Totals, disk activity chart, volume list. |
| Network page | ✅ | Rates, traffic chart, interface table (state, addresses, MAC, totals, link speed, MTU). |
| Navigation scroll reset | ✅ | Each section opens at the top (bug found in the real app). |

### Verification performed for M4
- `cargo test` — **71 passing** (59 unit incl. real termination of a spawned child, refusal on stale start time, self/PID 0 refusal, GPU parser/aggregation, panic containment; 4 real-hardware collector; 8 IPC incl. process stream on/off and `terminate_process` validation). clippy 0 warnings, fmt clean.
- `npm test` — **101 passing** (table filter/sort/virtual window maths; Processes page: stream toggle, search, sort, details, confirm/cancel/Escape, OS refusal shown, self protected, exited process; CPU/Memory/GPU/Storage/Network pages; scroll reset). Typecheck clean.
- **GPU cross-check vs Windows counters (WMI, same moment)** on the dev machine (AMD Radeon Vega 8): dedicated memory in use identical (1,122,631,680 B); utilisation 8.2 % vs busiest engine type 7 %. `sysinfo`'s provider had reported 92 % and 0 B on the same machine, which is why it is not used on Windows.
- **Real app** (`tauri dev`): Overview (with live GPU card), CPU, Memory and Network pages captured and checked. **GPU and Processes pages were not captured in the real app** — the window was minimised during the session and was left alone; they are covered by component tests and backend tests only.
- **Tick cost (release build, dev machine at ~100 % CPU from other work, median of 10)**: CPU usage 0.35 ms, frequency 0.01 ms, memory 0.17 ms, disks 6.4 ms, **networks 27 ms**, GPU 1.0 ms (`cargo run --release --example tick_breakdown`). Process list: 40–93 ms for ~320 processes (only while the Processes page is open).

## Feature status

| Area | Status | Milestone |
|---|---|---|
| Overview dashboard | ✅ | 3 |
| CPU / Memory / Storage / Network collectors | ✅ | 2 |
| CPU / Memory / Storage / Network pages | ✅ | 4 |
| Real-time event pipeline (sampler thread + events) | ✅ | 3 |
| GPU monitoring | 🟡 Windows ✅ (utilisation, VRAM); temperature unsupported; Linux/macOS unverified | 4 |
| Process manager | ✅ | 4 |
| History (SQLite) | ⬜ | 5 |
| Settings: theme | ✅ (localStorage, interim) | 1 → 6 |
| Settings: refresh, graphs, retention, startup, visibility | ⬜ Shown as "Not implemented" in UI | 6 |
| Settings: application info | ✅ | 1 |
| Installers (MSI/NSIS/DMG/AppImage) | ⬜ Not yet verified | 7 |
| Benchmarks | ⬜ (only the single debug timing above) | 7 |
| Docs: INSTALLATION, DEVELOPMENT, CONTRIBUTING, LICENSE | ⬜ | 7 (README, ARCHITECTURE, CLAUDE.md exist) |

## Known issues / limitations
- **Network refresh is the most expensive part of a tick (~27 ms, release).** `sysinfo` calls `GetIfTable2` every tick, which enumerates all (incl. hidden filter) interfaces. Planned M6 fix: query known interfaces with `GetIfEntry2`.
- Process list collection costs 40–93 ms per tick for ~320 processes; it only runs while the Processes page is open.
- GPU temperature is never available (no vendor-specific provider); NVML is not implemented because it cannot be verified without NVIDIA hardware.
- In the real-app session, two of four automated Ctrl+digit presses (sent with Windows SendKeys right after restoring the window) landed on a different section than expected. Cause not determined (likely focus timing in the test harness); the shortcut logic itself is covered by tests. Re-check manually.
- `freezePrototype` is disabled because Recharts' `decimal.js-light` cannot run with a frozen `Object.prototype` (see ARCHITECTURE.md).
- The sampler keeps running while the window is minimised/hidden; pausing or slowing it is planned for M6.
- The renderer CPU cost of re-rendering six charts per second has not been optimised or measured in a release build yet (M6).
- **CPU frequency on Windows** (backend) is the value from `CallNtPowerInformation`; on the dev machine it is a constant 3600 MHz (base clock), not the live boost clock. It is not shown in the UI yet; when it is (M4) it must be labelled "reported frequency" unless a better source is added.
- Disk I/O counters are unavailable for some volumes (virtual/network drives); shown as unsupported.
- Storage re-enumerates volumes every tick; cost is small (~18 ms for the whole debug tick) but should be re-measured in release and possibly reduced in M6.
- Only verified on Windows 11 x64. Linux/macOS untested.
- Windows test binaries need the Common Controls v6 manifest; `build.rs` embeds it for all MSVC link targets. Non-MSVC Windows toolchains are not handled.
- The first release-build attempt exited with code 4 while `cargo clippy` was running on the same `target/` directory; its Rust error output was not captured. An unchanged rerun succeeded, so lock/file contention is the likely (unconfirmed) cause. Avoid running two cargo commands at once here.
- `tauri build` without `--no-bundle` downloads WiX/NSIS on first run; installer creation not exercised yet.

## Blocked
Nothing blocked.
