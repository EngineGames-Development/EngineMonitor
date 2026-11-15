# EngineMonitor — Development Status

Last updated: 2026-11-15 · Current milestone: **1 (Foundation) — complete**

Legend: ✅ done and verified · 🟡 partial · ⬜ not started · ⛔ blocked

## Milestone 1 — Foundation ✅

| Item | Status | Notes |
|---|---|---|
| Repository inspection | ✅ | Folder was empty; git repo initialised on `main`. |
| Architecture & plan | ✅ | `ARCHITECTURE.md` |
| Tauri 2 initialised | ✅ | `src-tauri/`; Tauri 2.12, minimal capability file, strict CSP, command allow-list in `build.rs`. |
| React + TypeScript + Vite | ✅ | React 19, TypeScript 7, Vite 8, strict TS options. |
| Design system | ✅ | Tokens (`src/styles/index.css`), dark + light palettes, type scale, components in `src/design/`, in-repo icon set, brand mark/app icon. |
| Navigation | ✅ | Persistent sidebar with all 9 sections, grouped; Ctrl/Cmd+1..9 shortcuts; auto-collapse to icon rail < 1024 px. |
| Theme switching | ✅ | Dark / Light / System; persisted in WebView `localStorage` (**interim**: moves to the SQLite settings store in M6). |
| First IPC command | ✅ | `app_info` (build/version data only); used by sidebar version label and Settings → Application. |

### Verification performed (Windows 11 x64, Rust 1.96, Node 22)
- `npm run typecheck` — clean.
- `npm test` — 50 tests passing (formatters, theme, IPC wrapper, design components, app navigation).
- `cargo test` — 4 unit + 4 integration tests passing. Integration tests drive the real IPC layer with the production config and confirm: `app_info` works from `main`; unknown and plugin commands are rejected; windows without the capability are denied by the ACL.
- `cargo clippy --all-targets -D warnings` — 0 warnings. `cargo fmt --check` — clean.
- `npm run build` — production bundle builds (JS 76 KB gzip, CSS 5.4 KB gzip).
- `tauri build --no-bundle` (release executable) — **not yet confirmed**; the first optimised build was still running at commit time.
- Visual check of dark/light themes, Settings page and compact sidebar in a browser.

## Feature status

| Area | Status | Milestone |
|---|---|---|
| Overview dashboard | ⬜ Section shell only, no data | 3 |
| CPU monitoring | ⬜ | 2 (collector), 4 (page) |
| Memory monitoring | ⬜ | 2, 4 |
| GPU monitoring | ⬜ | 4 |
| Process manager | ⬜ | 4 |
| Storage monitoring | ⬜ | 2, 4 |
| Network monitoring | ⬜ | 2, 4 |
| Real-time event pipeline | ⬜ | 3 |
| History (SQLite) | ⬜ | 5 |
| Settings: theme | ✅ (localStorage, interim) | 1 → 6 |
| Settings: refresh, graphs, retention, startup, visibility | ⬜ Shown as "Not implemented" in UI | 6 |
| Settings: application info | ✅ | 1 |
| Installers (MSI/NSIS/DMG/AppImage) | ⬜ Not yet verified | 7 |
| Benchmarks | ⬜ | 7 |
| Docs: INSTALLATION, DEVELOPMENT, CONTRIBUTING, LICENSE | ⬜ | 7 (README + ARCHITECTURE exist) |

Sections without a collector render an explicit "not implemented" state and
**no numbers** — an app test asserts that no meters or percentages appear.

## Known issues / limitations
- Only verified on Windows 11 x64. Linux/macOS builds untested.
- Windows test binaries need the Common Controls v6 manifest; `build.rs` embeds
  it through the MSVC linker for all targets (tauri-build only does it for the
  main exe). Non-MSVC Windows toolchains (GNU) are not handled.
- `tauri build` without `--no-bundle` downloads WiX/NSIS on first run; installer
  creation has not been exercised yet.

## Blocked
Nothing blocked.
