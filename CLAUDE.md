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

**Data flow (target design, see `ARCHITECTURE.md`).** A single Rust sampler thread owns the `sysinfo` state and pushes snapshots to the frontend as Tauri events (`metrics://snapshot`). The frontend does not poll for metrics. `useCommand` (`src/ipc/useCommand.ts`) is only for one-shot commands. Rates (network, disk) are computed from counter deltas divided by measured elapsed time. A counter that decreases is treated as a reset and gives no rate for that tick. GPU access goes through a provider trait whose failures resolve to an explicit unsupported state.

As of milestone 2:
- The collectors exist. `system::SystemCollector` owns all `sysinfo` state, and `sample()` returns a `Snapshot`. The sampler thread and events (milestone 3) and the only command so far, `app_info`, don't use it yet.
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
- **Pages:** `src/pages/index.tsx` maps each `RouteId` to a page. A section with no collector renders `PlannedSection`, which shows the plan and no numbers. `src/App.test.tsx` asserts that no meters or percentages appear on such sections. Adjust that test when you implement the Overview.
- **Theming:** `src/styles/index.css` defines raw `--em-*` variables per `[data-theme]`, and `@theme inline` maps them to semantic Tailwind utilities (`bg-surface`, `bg-raised`, `border-line`, `text-fg-muted`, `text-primary`, …). Use those utilities, not raw colours, so both themes work. Chart colours are `--em-chart-*`.
- **Theme preference:** stored in localStorage by `src/theme/` for now. It is planned to move to the SQLite settings store in milestone 6.
- **Shared components:** design-system components and the hand-drawn icon set live in `src/design/` (import from `src/design/index.ts`). New icons go into the `paths` map in `Icon.tsx`. The project avoids extra icon, router, font and `clsx` dependencies on purpose.
- **Unit formatting:** `src/lib/format.ts`. Bytes use IEC units (KiB, MiB, GiB); bit rates use decimal units (kbit/s, Mbit/s).

**TypeScript settings:** `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on, so type-only imports must use `import type`.

**Tests.** `src/test/setup.ts` stubs `matchMedia` and clears localStorage and `data-theme` after each test. To mock the backend in Vitest, call `vi.mock("@tauri-apps/api/core", …)` with `isTauri` and `invoke`. Rust IPC tests use `tauri::test::mock_builder()` with the real `generate_context!()`, so they exercise the production capabilities and CSP config.
