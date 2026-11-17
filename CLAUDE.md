# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

EngineMonitor is a desktop system monitor: a Rust/Tauri 2 backend plus a React 19/TypeScript/Vite 8/Tailwind 4 frontend. Development goes milestone by milestone (see `ARCHITECTURE.md` §4). `DEVELOPMENT_STATUS.md` tracks what is done, partial, not started or blocked, and records how each item was verified. Update it whenever a feature's status changes.

## Project rules (from the product spec)
- Never show fabricated or hardcoded metrics. A metric that is unavailable, unsupported or not implemented must say so, using the `Availability` type and `AvailabilityBadge` in `src/design/Availability.tsx`. Formatters return `"—"` for invalid input.
- Only claim a check passed if you actually ran it. Report incomplete or unsupported features honestly in the docs.
- Keep the Tauri surface minimal: no extra plugins (fs, shell, http and so on) and no new capabilities without a clear need. The backend never makes network requests and never requires administrator rights.

## Commands
Run these from the repo root unless noted. In Git Bash, `cargo` is not on `PATH`; run `export PATH="$HOME/.cargo/bin:$PATH"` first. Don't run two cargo commands at once: they compete for `src-tauri/target/`. A release build (LTO) takes about 12 minutes; the first debug test build takes about 5 minutes.

```bash
npm run tauri dev            # run the desktop app (starts Vite on :1420)
npm run dev                  # frontend only in a browser; backend calls return kind "no_backend"
npm run typecheck            # tsc for src/ (tsconfig.json) and vite.config.ts (tsconfig.node.json)
npm test                     # Vitest, all frontend tests
npx vitest run src/lib/format.test.ts      # one test file
npx vitest run -t "supports Ctrl+digit"    # tests matching a name
npm run build                # typecheck, then production bundle into dist/
npx tauri build --no-bundle  # release exe; skips installers (bundling downloads WiX/NSIS)

cd src-tauri
cargo test                   # unit tests plus tests/ipc.rs integration tests
cargo test --test ipc        # IPC integration tests only
cargo test --test collectors # collectors against this machine's real hardware
cargo run --example snapshot # print real SystemInfo + Snapshot JSON and the tick time
cargo test error::tests      # one module's unit tests
cargo clippy --all-targets -- -D warnings   # must stay at zero warnings
cargo fmt --check
```

## Architecture

**Data flow (see `ARCHITECTURE.md`).**
- **Backend:** one sampler thread (`events/`) owns the `SystemCollector`. It emits a `SnapshotEvent` (`sequence`, `intervalMs`, `snapshot`) on `metrics://snapshot` to the `main` window every tick.
- **Start-up:** monitoring starts in `init(&app)` between `build()` and `run()`, not in a `setup` hook, because `setup` never runs under the mock runtime. Integration tests must call `enginemonitor_lib::init(&app)` after building the app.
- **Frontend:** `MetricsProvider` (`src/metrics/`) holds the app's only subscription. Pages read from `useMetrics()` and never subscribe or poll themselves. The store logic is a pure reducer (`store.ts`, `history.ts`) and is unit-tested directly. `useCommand` (`src/ipc/useCommand.ts`) is only for one-shot commands.
- **Prototype freezing:** don't re-enable `freezePrototype` in `tauri.conf.json`. It crashes Recharts at startup in the real app, and jsdom tests won't catch it.
- **Real-app verification:** run `npm run tauri dev`. Stop the dev app before running `cargo test`: Windows locks `target/debug/enginemonitor.exe` while it runs. Stopping the task can leave the Vite dev server (`node … vite.js`) orphaned; kill it as well. The window can be captured without screenshotting the whole desktop using `PrintWindow` with the `PW_RENDERFULLCONTENT` flag. Rates (network, disk) are computed from counter deltas divided by measured elapsed time. A counter that decreases is treated as a reset and gives no rate for that tick. GPU access goes through a provider trait whose failures resolve to an explicit unsupported state.

Collectors:
- `system::SystemCollector` owns all `sysinfo` state; `sample(&mut GpuMonitor)` returns a `Snapshot`.
- GPU providers (`gpu/`) may hold thread-affine OS handles and are not `Send`. That's why the GPU monitor is passed into `sample()` rather than owned, and why the sampler builds it on its own thread with `Sampler::spawn_with`. Don't add `Send` bounds or `unsafe impl Send` to work around this.
- On Windows, GPU data comes from the own DXGI + PDH provider (`gpu/windows_provider.rs`), not `sysinfo` (whose Windows GPU numbers were wrong). Network counters come from `GetIfTable2` each tick (`network/windows_table.rs`, ~3 ms instead of ~20 ms for `sysinfo`'s refresh); `network/source.rs` re-reads IP addresses through `sysinfo` only when the interface set changes or every 30 s. Any `unsafe` code lives in those two files and in `processes/terminate.rs`, with SAFETY comments.
- Processes are collected only while `set_process_monitoring(true)` is in effect (the Processes page) and the window is visible. While the window is minimised (detected in `configure()`'s `on_window_event`), the sampler runs at max(interval, `HIDDEN_INTERVAL_MS` = 5 s).
- App settings (`settings/app.rs`) are applied through `MonitorState::set_app_settings`, which validates, persists and then applies the refresh interval to the running sampler. Identify a process by (PID, start time), never by PID alone; `terminate_process` requires both.
- `cargo run --release --example tick_breakdown` times each collector; use it before and after performance work.

History (SQLite, `history/`):
- **Location:** `<app data dir>/history.sqlite3` (on Windows, `%APPDATA%\dev.enginemonitor.desktop`).
- **Schema changes:** add a new entry to `MIGRATIONS` in `history/schema.rs`. Never edit a released migration.
- **Writes:** only the writer thread writes history rows. The sampler hands records over with a non-blocking `try_send`, and commands read through `History`'s own connection.
- **Tests:** integration tests must call `init_with_data_dir(&app, Some(temp_dir))`, never `init(&app)`, so they don't write to the real user database.
- **SQLite pitfalls (covered by tests):** set `auto_vacuum` before WAL on a new database, and step `PRAGMA incremental_vacuum` to completion (`execute_batch` frees only one page).
- **Size check:** `cargo run --release --example history_size` measures bytes per row.
- Each domain module (`cpu/`, `memory/`, `storage/`, `network/`) has a pure `build`/`build_sample` function that takes plain values. Unit tests target that function; a thin `sample()` reads from `sysinfo`.
- Missing values: use `Option` for "not measured this tick" (first tick, counter reset). Use `reading::Reading<T>` (`ok` / `unsupported` / `error`, serialised with a `status` tag) where availability depends on the platform.
- `sysinfo` reports unknown CPU frequency as 0 MHz and missing disk I/O counters as 0 bytes. Treat both as unavailable, not as real zeros.

**Adding a backend command touches four places, all required:**
1. `#[tauri::command]` in `src-tauri/src/commands.rs` (or a module), registered in `configure()` in `src-tauri/src/lib.rs`. Both the real app and the integration tests build through `configure()`.
2. The `COMMANDS` list in `src-tauri/build.rs`. That list generates an `allow-<kebab-name>` permission.
3. That permission added to `src-tauri/capabilities/default.json`. Capabilities apply to the `main` window only. Without the permission, the IPC layer rejects the call with "not allowed".
4. A typed wrapper in `src/ipc/commands.ts` built on `call()`. `call()` never throws: it returns `{ ok, value } | { ok, error }` and short-circuits with `no_backend` when `isTauri()` is false.

Rust types sent to the frontend use `#[serde(rename_all = "camelCase")]` and are mirrored by hand as TS interfaces. `AppError` (`src-tauri/src/error.rs`) serialises as `{ kind, message }`. `src/ipc/errors.ts` mirrors that and adds the frontend-only `no_backend` kind. When you add an error variant, update both files.

**Windows build quirk.** `build.rs` turns off tauri-build's app manifest and embeds `windows-app-manifest.xml` (Common Controls v6) through MSVC linker arguments for every link target. Without it, the `tests/ipc.rs` binary fails at startup with `STATUS_ENTRYPOINT_NOT_FOUND`.

**Frontend structure.**
- **Navigation:** state-based, with no router. The `ROUTES` order in `src/navigation/routes.ts` sets both sidebar order and the Ctrl/Cmd+1..9 shortcuts.
- **Pages:** `src/pages/index.tsx` maps each `RouteId` to a page. Live pages use `LivePage` (`src/pages/shared.tsx`) for header, error and loading states. `src/App.test.tsx` asserts that no section shows meters or percentages without a backend. Test payloads come from `src/test/fixtures.ts`, which is for tests only.
- **Deep links:** the URL hash selects the initial section (`#history`). For real-app checks of a specific page, run `npx tauri dev --config '{"build":{"devUrl":"http://localhost:1420/#history"}}'`, so no keyboard automation is needed.
- **Theming:** `src/styles/index.css` defines raw `--em-*` variables per `[data-theme]`, and `@theme inline` maps them to semantic Tailwind utilities (`bg-surface`, `bg-raised`, `border-line`, `text-fg-muted`, `text-primary`, …). Use those utilities, not raw colours, so both themes work. Chart colours are `--em-chart-*`.
- **Settings:** `SettingsProvider` (`src/settings/`) loads `AppSettings` from the backend (SQLite is the source of truth) and saves every change as the complete object via `update(patch)`, which resolves to an `AppError | null` instead of throwing. Only the theme is also cached in localStorage, for the first paint. Without a backend the source is `"local"`: defaults, not persisted. Provider order in `App.tsx`: Settings > Theme > ChartPrefs > Metrics > Navigation. Components that read settings need `SettingsProvider` in tests: wrap them in `TestProviders` (`src/test/providers.tsx`), and make the mocked `invoke` answer `app_settings` with a valid object (`DEFAULT_APP_SETTINGS`), since malformed payloads are rejected by `isAppSettings`.
- **Network units:** format network rates with `useNetworkFormat()` (`src/settings/useFormatters.ts`), which follows the user's bits/bytes setting; don't call the bit-rate formatters directly in pages.
- **Shared components:** design-system components and the hand-drawn icon set live in `src/design/` (import from `src/design/index.ts`). New icons go into the `paths` map in `Icon.tsx`. The project avoids extra icon, router, font and `clsx` dependencies on purpose.
- **Rendering cost:** don't add infinite CSS animations or transitions on values that update every tick (they keep WebView2 repainting at 60 fps; see ARCHITECTURE.md "No continuous animations"), and don't call `toLocale*String` in chart formatters (use cached `Intl` formatters).
- **Unit formatting:** `src/lib/format.ts`. Bytes use IEC units (KiB, MiB, GiB); bit rates use decimal units (kbit/s, Mbit/s).

**TypeScript settings:** `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on, so type-only imports must use `import type`.

**Tests.** `src/test/setup.ts` stubs `matchMedia` and clears localStorage and `data-theme` after each test. To mock the backend in Vitest, call `vi.mock("@tauri-apps/api/core", …)` with `isTauri` and `invoke`. Rust IPC tests use `tauri::test::mock_builder()` with the real `generate_context!()`, so they exercise the production capabilities and CSP config.
