# EngineMonitor — Development Status

Last updated: 2026-11-16 · Current milestone: **2 (Collectors) — complete** · Next: 3 (live data to the UI)

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

Backend only; nothing is sent to the UI yet (that is milestone 3).

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

## Feature status

| Area | Status | Milestone |
|---|---|---|
| Overview dashboard | ⬜ Section shell only, no data | 3 |
| CPU / Memory / Storage / Network collectors | ✅ | 2 |
| CPU / Memory / Storage / Network pages | ⬜ | 3–4 |
| Real-time event pipeline (sampler thread + events) | ⬜ | 3 |
| GPU monitoring | ⬜ | 4 |
| Process manager | ⬜ | 4 |
| History (SQLite) | ⬜ | 5 |
| Settings: theme | ✅ (localStorage, interim) | 1 → 6 |
| Settings: refresh, graphs, retention, startup, visibility | ⬜ Shown as "Not implemented" in UI | 6 |
| Settings: application info | ✅ | 1 |
| Installers (MSI/NSIS/DMG/AppImage) | ⬜ Not yet verified | 7 |
| Benchmarks | ⬜ (only the single debug timing above) | 7 |
| Docs: INSTALLATION, DEVELOPMENT, CONTRIBUTING, LICENSE | ⬜ | 7 (README, ARCHITECTURE, CLAUDE.md exist) |

## Known issues / limitations
- **CPU frequency on Windows** is the value from `CallNtPowerInformation`; on the dev machine it is a constant 3600 MHz (base clock), not the live boost clock. The UI must label it "reported frequency" (M3/M4) unless a better source is added.
- Disk I/O counters are unavailable for some volumes (virtual/network drives); shown as unsupported.
- Storage re-enumerates volumes every tick; cost is small (~18 ms for the whole debug tick) but should be re-measured in release and possibly reduced in M6.
- Only verified on Windows 11 x64. Linux/macOS untested.
- Windows test binaries need the Common Controls v6 manifest; `build.rs` embeds it for all MSVC link targets. Non-MSVC Windows toolchains are not handled.
- The first release-build attempt exited with code 4 while `cargo clippy` was running on the same `target/` directory; its Rust error output was not captured. An unchanged rerun succeeded, so lock/file contention is the likely (unconfirmed) cause. Avoid running two cargo commands at once here.
- `tauri build` without `--no-bundle` downloads WiX/NSIS on first run; installer creation not exercised yet.

## Blocked
Nothing blocked.
