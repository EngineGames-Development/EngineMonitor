# EngineMonitor

A cross-platform desktop system monitor built with Rust, Tauri 2 and React.

> **Status: milestone 6 of 7 (settings & performance) done; milestone 7
> (hardening, installers, remaining docs) next.** Verified on Windows 11 x64
> only; Linux and macOS are untested. See
> [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for exact progress, including
> what is partial or unsupported.

## What works today
- **Live monitoring** pushed from one Rust sampler thread: CPU (total and per
  core), memory and swap, storage volumes and disk I/O, network interfaces and
  traffic, GPU utilisation and dedicated memory (Windows, via DXGI + PDH).
  Values the OS doesn't provide are labelled unavailable, never faked.
- **Sections:** Overview, CPU, Memory, GPU, Processes, Storage, Network,
  History, Settings, with keyboard navigation `Ctrl+1` … `Ctrl+9` (`⌘` on macOS).
- **Process manager:** search, sort, filter, details and guarded termination
  (with confirmation; critical system processes are refused).
- **History:** averaged samples in a local SQLite database with configurable
  interval and retention (1–365 days), and charts over 15 minutes to 30 days.
- **Settings:** theme (dark, light, system), refresh interval, live graph
  length, network units (bits/bytes), Overview sections, start minimised,
  launch at login. Settings are stored in the local database.
- **Low overhead:** about 8 % of one CPU core in total while visible and about
  3 % while minimised, measured on a 4-core Ryzen 3 3200G (release build).

## Requirements
- Rust (stable, 1.80+) and Node.js 20+.
- Platform prerequisites for Tauri 2: <https://tauri.app/start/prerequisites/>
  (on Windows: Visual Studio C++ build tools and WebView2).

## Run
```bash
npm install
npm run tauri dev
```

## Test
```bash
npm run typecheck
npm test
cd src-tauri && cargo test
```

## Privacy and security
EngineMonitor makes no network requests and sends no data anywhere. It does
not require administrator rights. The webview runs under a strict Content
Security Policy, and only explicitly allow-listed backend commands can be
called. See [ARCHITECTURE.md](ARCHITECTURE.md).
