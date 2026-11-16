# EngineMonitor — Architecture

This document describes how EngineMonitor is built and why. It is kept in sync
with the code; sections that describe work not yet implemented are marked
**(planned)**. See `DEVELOPMENT_STATUS.md` for the per-feature status.

## 1. High-level design

```
┌────────────────────────── Tauri process (Rust) ──────────────────────────┐
│                                                                          │
│  Sampler thread (M3, done)             History writer (planned, M5)      │
│  ├─ owns SystemCollector (M2, done)    ├─ owns rusqlite::Connection     │
│  ├─ refreshes at user interval          ├─ batched INSERTs in one txn    │
│  ├─ builds a compact Snapshot           └─ periodic retention cleanup    │
│  └─ emits `metrics://snapshot` event ──────────────┐                     │
│                                                    │                     │
│  Commands (validated, minimal surface)             │                     │
│  ├─ app_info               (M1, implemented)       │                     │
│  ├─ system_info / latest_snapshot (M3, implemented)│                     │
│  ├─ get_settings / update_settings (planned)       │                     │
│  ├─ query_history          (planned)               │                     │
│  ├─ set_process_monitoring (M4, implemented)       │                     │
│  └─ terminate_process      (M4, guarded)           │                     │
└────────────────────────────────────────────────────┼─────────────────────┘
                                                     │ Tauri IPC / events
┌──────────────────────── WebView (React + TS) ──────┼─────────────────────┐
│  ipc/      typed wrappers around invoke() + listen()                     │
│  metrics/  MetricsProvider: one subscription → capped history (M3)       │
│  pages/    Overview · CPU · Memory · GPU · Processes · Storage ·          │
│            Network · History · Settings                                  │
│  design/   design-system components (Card, Meter, Badge, EmptyState…)    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key decisions

| Decision | Reason |
|---|---|
| **Push, not poll.** One Rust sampler thread emits snapshots as Tauri events. | The frontend never runs timers to fetch metrics, so there is one refresh cadence and one `sysinfo` instance. Listener cleanup is centralised in one hook. |
| **Single owner of `sysinfo` state.** | `sysinfo` computes CPU usage and network deltas from consecutive refreshes. A single long-lived owner keeps those deltas correct and avoids re-allocating process tables. |
| **Rates computed by us, not trusted blindly.** | Network/disk speeds are derived from cumulative counters ÷ measured elapsed time (`Instant`). A counter that goes *down* (interface reset, driver reload) is treated as a reset and yields no rate for that tick instead of a negative/huge spike. |
| **Process list is opt-in.** | Collecting all processes costs ~40–90 ms per tick (≈320 processes, release build, dev machine). `set_process_monitoring` turns it on only while the Processes page is mounted; the list then rides in the same `SnapshotEvent` (`processes` field). Switching it back on resets per-process state so the first tick does not report CPU averaged over the pause. |
| **Guarded termination.** | `terminate_process(pid, startTimeSecs)` refuses PID 0, EngineMonitor itself and session-critical processes (`csrss`, `wininit`, `lsass`, … / PID 1 on Unix). On Windows it opens the process first; while that handle is held the PID cannot be reused, so the start-time check against what the user confirmed is race-free. `OpenProcess`/`TerminateProcess` are called directly (not `sysinfo`'s `taskkill` wrapper) to report "access denied" vs "not found" precisely. The UI requires an explicit confirmation dialog. |
| **GPU behind a trait, isolated.** | One `GpuProvider` per platform: Windows uses an own DXGI + PDH provider (`gpu/windows_provider.rs`); elsewhere `sysinfo`'s GPU support. `GpuMonitor` wraps provider init and sampling in `catch_unwind`; a failing or panicking provider becomes a `Reading::Error` for the GPU section only (the release profile uses `panic = "unwind"` for this). Providers may hold thread-affine OS handles, so the sampler builds them *on its own thread* (`Sampler::spawn_with`) instead of requiring `Send`. |
| **Own Windows GPU provider instead of `sysinfo`'s.** | On the dev machine `sysinfo` reported 92 % GPU (it sums all engines: 3D 49 % + video 43 %) and 0 bytes of dedicated memory (wrong adapter). The own provider follows Task Manager (busiest engine type per adapter, matched by LUID) and matched Windows' counters byte-for-byte for memory. |
| **SQLite via `rusqlite` (bundled).** | No system SQLite dependency, deterministic builds, synchronous API that fits a dedicated writer thread (no async runtime required). |
| **History is downsampled.** | Live data is held in memory (ring buffers). Only every *n*-th sample (configurable, default 5 s) is written to disk, in batched transactions, with a retention window enforced by periodic `DELETE`s. |
| **No routing / icon / font dependencies.** | Navigation is a small typed state machine; icons are a hand-drawn SVG set; fonts use the OS UI stack. Fewer dependencies, no network fetches, smaller bundle. |
| **Minimal Tauri permissions.** | No `fs`, `shell`, `http` or `opener` plugins. The capability file grants only core event + window permissions and our own commands. A strict CSP blocks remote resources. |
| **`freezePrototype` is off.** | Tauri's `freezePrototype` freezes `Object.prototype`. Recharts depends on `decimal.js-light`, which assigns `valueOf` on its own prototype; with a frozen `Object.prototype` that assignment throws (the JS "override mistake") and the UI fails to start. Found in the real app in M3 (jsdom tests do not freeze prototypes). Since Recharts is a required dependency, the option is disabled. Prototype-pollution exposure remains low: no remote content is loaded (CSP `default-src 'self'`), and the IPC surface is an explicit allow-list. |
| **Monitoring starts in `init(&app)`, not a `setup` hook.** | Tauri runs `setup` only once the event loop starts. Starting between `build()` and `run()` lets the integration tests (mock runtime, no event loop) exercise the same start-up path. Events emitted before the window loads are lost; the frontend calls `latest_snapshot` once after subscribing to cover that gap. |
| **Missed events become gaps.** | Each event carries a `sequence`. A jump in sequence inserts a null point into the live history, so charts show a gap instead of a straight line across missing data. No event for 3 × interval marks the stream "Stale". |

## 2. Directory structure

```
EngineMonitor/
├─ index.html                 Vite entry
├─ package.json               frontend deps + scripts
├─ vite.config.ts             Vite + Tailwind + Vitest config
├─ src/                       React + TypeScript frontend
│  ├─ main.tsx, App.tsx
│  ├─ styles/index.css        design tokens (CSS variables) + Tailwind theme
│  ├─ design/                 design-system components + icon set
│  ├─ layout/                 AppShell, Sidebar
│  ├─ navigation/             route table + navigation state
│  ├─ theme/                  theme provider (dark / light / system)
│  ├─ ipc/                    typed Tauri command / event wrappers
│  ├─ lib/                    pure helpers (unit formatting, …) — unit tested
│  ├─ pages/                  one file per section
│  └─ test/                   test setup
└─ src-tauri/                 Rust backend
   ├─ Cargo.toml, build.rs, tauri.conf.json
   ├─ capabilities/default.json
   └─ src/
      ├─ main.rs, lib.rs      entry + Tauri builder
      ├─ error.rs             AppError (serialisable to the frontend)
      ├─ commands.rs          command handlers (thin; validate + delegate)
      ├─ rate.rs              counter → rate maths (resets, vanished keys)
      ├─ reading.rs           Reading<T>: ok / unsupported / error
      ├─ system/              OS facts + SystemCollector (owns all sysinfo state)
      ├─ cpu/ memory/ storage/ network/   per-domain collectors (M2, done)
      ├─ gpu/                 GpuProvider trait, GpuMonitor, windows_provider (DXGI+PDH), sysinfo_provider (non-Windows)
      ├─ processes/           ProcessCollector, terminate (guarded)
      ├─ events/              sampler thread (generic, Condvar-timed) + MonitorState (M3)
      ├─ history/ settings/               (planned, M5–M6)
   ├─ tests/                  ipc.rs (IPC + ACL), collectors.rs (real hardware)
   └─ examples/snapshot.rs    prints a real snapshot as JSON
```

## 3. Dependencies

### Rust
| Crate | Use |
|---|---|
| `tauri` 2.x, `tauri-build` 2.x | desktop shell, IPC, events |
| `serde`, `serde_json` | IPC serialisation |
| `thiserror` | typed errors |
| `sysinfo` 0.40 (features `system`, `disk`, `network`; default features off) | CPU, memory, disks, networks; processes from M4 |
| `rusqlite` + `bundled` (planned, M5) | history + settings persistence |
| `nvml-wrapper` (not added) | NVIDIA temperature would need it; not implemented because it cannot be verified without NVIDIA hardware |
| `windows` 0.62 (Windows only; same version `sysinfo` already uses) | DXGI adapters, PDH GPU counters, `OpenProcess`/`TerminateProcess` |
| `tauri-plugin-autostart` (planned, M6) | "launch at login" setting |

### Frontend
| Package | Use |
|---|---|
| `react`, `react-dom` 19 | UI |
| `@tauri-apps/api` 2 | `invoke` / `listen` |
| `tailwindcss` 4 + `@tailwindcss/vite` | styling, tokens via `@theme` |
| `recharts` 3 | charts (adds ~110 KB gzip to the bundle; acceptable for a local app, revisit in M6) |
| ~~`@tanstack/react-virtual`~~ | not used: the process table uses a 40-line in-repo hook (`useVirtualRows`) |
| `vite`, `typescript`, `vitest`, `@testing-library/*`, `jsdom` | dev / test only |

## 4. Milestones

1. **Foundation** — repository, Tauri 2 + React + TS + Vite, design system, navigation, first IPC command.
2. **Collectors** — Rust `system`, `cpu`, `memory`, `storage`, `network` modules with unit-tested rate math.
3. **Live data** — sampler thread + events, frontend subscription store, Overview with real-time graphs.
4. **Depth** — process manager (search/sort/filter/virtualise/detail/terminate), GPU providers, dedicated pages.
5. **History** — SQLite schema, batched writer, retention, History page.
6. **Settings & polish** — persisted settings, theme switching from settings, autostart, performance work.
7. **Hardening** — full test pass, bug fixes, production build, benchmarks, documentation.

## 5. Known technical limitations

- **GPU metrics are vendor- and OS-specific.** Windows: utilisation and dedicated VRAM for any vendor via DXGI + PDH (verified on an AMD Vega 8 iGPU). Temperature is not available through these APIs and is shown as unsupported; NVML (NVIDIA) is not implemented. Linux/macOS use `sysinfo`'s GPU support, which is unverified on real hardware. Shared (system) GPU memory is not shown.
- **CPU temperature** is usually unavailable on Windows without administrator rights or a kernel driver; it will not be faked.
- **CPU load average** exists on Linux/macOS only; Windows has no equivalent and it is shown as unavailable there.
- **Per-process executable paths** of protected/system processes are hidden by the OS for non-elevated users; they will display as "access denied", not guessed.
- **Process termination** can fail for protected processes or processes owned by other users; the error is reported verbatim.
- **Disk I/O** comes from per-volume cumulative counters (`IOCTL_DISK_PERFORMANCE` on Windows). Some volumes (virtual drives such as Google Drive, some network/removable media) report no counters; they are shown as "I/O unavailable", not as idle.
- **CPU frequency on Windows** is what `sysinfo` reads from `CallNtPowerInformation`. On the development machine (Ryzen 3 3200G) it is a constant 3600 MHz, i.e. the base clock, not the live boost clock Task Manager shows. It must be labelled "reported frequency" in the UI until a better source (PDH `% Processor Performance`) is evaluated.
- **Loopback** is excluded from aggregate network speed. Windows does not list a loopback interface through `sysinfo` at all.
- **Development environment:** this repository is currently developed and verified on Windows 11 (x64). Linux and macOS builds are expected to work through Tauri/`sysinfo` but have not been verified on real hardware yet.
