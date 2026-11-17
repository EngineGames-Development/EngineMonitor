# Developing EngineMonitor

This guide covers setting up, running, testing and measuring EngineMonitor.
Read [ARCHITECTURE.md](ARCHITECTURE.md) for how the parts fit together and
why, and [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for what is done,
partial or unsupported.

## Setup

- Rust 1.95+ (`rustup`), Node.js 22.22+ or 24.15+.
- Tauri prerequisites for your OS: <https://tauri.app/start/prerequisites/>.

```bash
npm ci
npm run tauri dev     # desktop app with hot reload (Vite on http://localhost:1420)
```

`npm run dev` runs only the frontend in a browser. Backend calls then return
an error of kind `no_backend`, and every section shows that it has no data.
That's useful for layout work.

## Commands

Run from the repository root unless noted.

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript for `src/` and the Vite config |
| `npm test` | all frontend tests (Vitest + Testing Library, jsdom) |
| `npx vitest run src/lib/format.test.ts` | one test file |
| `npm run build` | typecheck, then the production bundle in `dist/` |
| `npx tauri build --no-bundle` | release executable without installers |
| `npx tauri build` | release executable plus MSI and NSIS installers (Windows) |
| `cd src-tauri && cargo test` | Rust unit tests, IPC integration tests, hardware tests |
| `cargo test --test ipc` | IPC tests only (mock runtime, real capabilities and CSP) |
| `cargo test --test collectors` | collectors against this machine's real hardware |
| `cargo clippy --all-targets -- -D warnings` | lints; must stay at zero warnings |
| `cargo fmt --check` | formatting |
| `cargo run --example snapshot` | prints a real snapshot as JSON |
| `cargo run --release --example tick_breakdown` | time per collector (use before and after performance work) |
| `cargo run --release --example history_size` | bytes per history row |

Don't run two cargo commands at the same time; they compete for
`src-tauri/target/`. Stop a running dev app before `cargo test` on Windows,
which locks `target/debug/enginemonitor.exe` while it runs.

## Project layout

```
src/                 React + TypeScript frontend
  design/            design-system components and icons
  ipc/               typed wrappers for commands and events
  metrics/           the single live-data subscription and its store
  settings/          SettingsProvider (settings come from the backend)
  pages/             one folder per section
src-tauri/           Rust backend
  src/system/        SystemCollector, owner of all sysinfo state
  src/cpu|memory|storage|network|gpu|processes/   collectors
  src/events/        sampler thread and MonitorState
  src/history/       SQLite schema, writer thread, queries
  src/settings/      validated settings stored in SQLite
  tests/             ipc.rs (IPC + permissions), collectors.rs (real hardware)
```

## Rules the code follows

- **Never show invented numbers.** A metric that is unavailable, unsupported
  or not measured yet says so (`Reading<T>` in Rust, `Availability` in the
  UI). Formatters return `—` for invalid input.
- **Small, explicit backend surface.** No `fs`, `shell`, `http` or similar
  plugins. Every command is listed in `src-tauri/build.rs` and granted in
  `src-tauri/capabilities/default.json`. Validate every argument in Rust.
- **No administrator rights and no network access** for anything the app does.
- **Low overhead.** Measure before and after; see "Performance" below.

### Adding a backend command (four places)
1. `#[tauri::command]` function in `src-tauri/src/commands.rs`, registered in
   `configure()` in `src-tauri/src/lib.rs`.
2. Its name in `COMMANDS` in `src-tauri/build.rs` (generates `allow-<name>`).
3. That permission in `src-tauri/capabilities/default.json`.
4. A typed wrapper in `src/ipc/commands.ts` built on `call()`.

Add an IPC test in `src-tauri/tests/ipc.rs` for it, including invalid input.

## Testing

- **Rust unit tests** sit next to the code. Collectors keep their logic in
  pure `build` functions that take plain values, so tests don't depend on the
  machine.
- **IPC integration tests** (`tests/ipc.rs`) build the real app on Tauri's
  mock runtime with the production capabilities and CSP. They use a temporary
  data directory (`init_with_data_dir`), never your real database.
- **Hardware tests** (`tests/collectors.rs`) check invariants on the machine
  running them (RAM > 0, percentages in range, rates never negative).
- **Frontend tests** mock `@tauri-apps/api/core`. Components that read
  settings need `TestProviders` (`src/test/providers.tsx`). Shared test
  payloads are in `src/test/fixtures.ts` (tests only).

CI runs all of this on Windows, Ubuntu and macOS for every push and pull
request (`.github/workflows/ci.yml`).

## Checking the real app

Tests don't replace a look at the real app. Useful techniques:

- Open a section directly:
  `npx tauri dev --config '{"build":{"devUrl":"http://localhost:1420/#history"}}'`.
- Inspect the WebView: on Windows, start the app with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1`
  and connect with Edge or Chrome DevTools (`edge://inspect`) or the DevTools
  protocol. Only do this locally, and never ship it.

## Performance

- `cargo run --release --example tick_breakdown` shows what each collector
  costs per update.
- For whole-app numbers, measure CPU time and private memory of
  `enginemonitor.exe` **and** its WebView2 child processes in a release build.
  The WebView usually costs far more than the backend.
- Avoid infinite CSS animations and transitions on values that change every
  update: they keep WebView2 repainting at 60 fps. Avoid creating `Intl`
  formatters (`toLocale*String`) in code that runs per render.

The current benchmark is in DEVELOPMENT_STATUS.md.
