# EngineMonitor — Architecture

This document describes how EngineMonitor is built and why. It is kept in sync
with the code; sections that describe work not yet implemented are marked
**(planned)**. See `DEVELOPMENT_STATUS.md` for the per-feature status.

## 1. High-level design

```
┌────────────────────────── Tauri process (Rust) ──────────────────────────┐
│                                                                          │
│  Sampler thread (planned, M2)          History writer (planned, M5)      │
│  ├─ owns sysinfo::System/Networks/Disks ├─ owns rusqlite::Connection     │
│  ├─ refreshes at user interval          ├─ batched INSERTs in one txn    │
│  ├─ builds a compact Snapshot           └─ periodic retention cleanup    │
│  └─ emits `metrics://snapshot` event ──────────────┐                     │
│                                                    │                     │
│  Commands (validated, minimal surface)             │                     │
│  ├─ app_info               (M1, implemented)       │                     │
│  ├─ get_settings / update_settings (planned)       │                     │
│  ├─ query_history          (planned)               │                     │
│  ├─ set_process_stream     (planned)               │                     │
│  └─ terminate_process      (planned, guarded)      │                     │
└────────────────────────────────────────────────────┼─────────────────────┘
                                                     │ Tauri IPC / events
┌──────────────────────── WebView (React + TS) ──────┼─────────────────────┐
│  ipc/      typed wrappers around invoke() + listen()                     │
│  store     single subscription → ring buffers for live graphs (planned)   │
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
| **Process list is opt-in.** | Collecting full process details is the most expensive part of sampling. It is only included while the Processes page (or Overview top-list) is mounted. |
| **GPU behind a trait.** | `GpuProvider` implementations are tried in order (NVML for NVIDIA, Windows PDH/DXGI for any vendor on Windows). Every failure resolves to an explicit `Unsupported { reason }` value; GPU errors can never stop the sampler. |
| **SQLite via `rusqlite` (bundled).** | No system SQLite dependency, deterministic builds, synchronous API that fits a dedicated writer thread (no async runtime required). |
| **History is downsampled.** | Live data is held in memory (ring buffers). Only every *n*-th sample (configurable, default 5 s) is written to disk, in batched transactions, with a retention window enforced by periodic `DELETE`s. |
| **No routing / icon / font dependencies.** | Navigation is a small typed state machine; icons are a hand-drawn SVG set; fonts use the OS UI stack. Fewer dependencies, no network fetches, smaller bundle. |
| **Minimal Tauri permissions.** | No `fs`, `shell`, `http` or `opener` plugins. The capability file grants only core event + window permissions and our own commands. A strict CSP blocks remote resources. |

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
      ├─ system/  cpu/  memory/  gpu/  processes/      (planned, M2–M4)
      ├─ storage/ network/   history/  settings/  events/ (planned, M2–M6)
```

## 3. Dependencies

### Rust
| Crate | Use |
|---|---|
| `tauri` 2.x, `tauri-build` 2.x | desktop shell, IPC, events |
| `serde`, `serde_json` | IPC serialisation |
| `thiserror` | typed errors |
| `sysinfo` (planned, M2) | CPU, memory, disks, networks, processes |
| `rusqlite` + `bundled` (planned, M5) | history + settings persistence |
| `nvml-wrapper` (planned, M4) | NVIDIA GPU metrics; loads `nvml.dll`/`libnvidia-ml.so` at runtime, so non-NVIDIA systems are unaffected |
| `windows` crate (planned, M4, Windows only) | PDH GPU-engine counters + DXGI adapter memory |
| `tauri-plugin-autostart` (planned, M6) | "launch at login" setting |

### Frontend
| Package | Use |
|---|---|
| `react`, `react-dom` 19 | UI |
| `@tauri-apps/api` 2 | `invoke` / `listen` |
| `tailwindcss` 4 + `@tailwindcss/vite` | styling, tokens via `@theme` |
| `recharts` 3 (from M3) | charts |
| `@tanstack/react-virtual` (planned, M4) | virtualised process table |
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

- **GPU metrics are vendor- and OS-specific.** `sysinfo` has no GPU support. NVIDIA via NVML is reliable on Windows/Linux. On Windows, AMD/Intel utilisation can come from PDH "GPU Engine" counters and VRAM from DXGI, but temperature is generally *not* exposed without vendor SDKs. macOS exposes very little without private APIs. Unsupported values are shown as unsupported.
- **CPU temperature** is usually unavailable on Windows without administrator rights or a kernel driver; it will not be faked.
- **CPU load average** exists on Linux/macOS only; Windows has no equivalent and it is shown as unavailable there.
- **Per-process executable paths** of protected/system processes are hidden by the OS for non-elevated users; they will display as "access denied", not guessed.
- **Process termination** can fail for protected processes or processes owned by other users; the error is reported verbatim.
- **Disk I/O** in `sysinfo` is per-process-aggregated on some platforms; per-disk activity accuracy varies by OS and is labelled accordingly.
- **Development environment:** this repository is currently developed and verified on Windows 11 (x64). Linux and macOS builds are expected to work through Tauri/`sysinfo` but have not been verified on real hardware yet.
