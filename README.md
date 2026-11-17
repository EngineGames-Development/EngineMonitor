# EngineMonitor

[![CI](https://github.com/EngineGames-Development/EngineMonitor/actions/workflows/ci.yml/badge.svg)](https://github.com/EngineGames-Development/EngineMonitor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A fast, private desktop system monitor built with Rust, Tauri 2 and React.
It shows live CPU, memory, GPU, process, storage and network data, keeps a
local history, and never sends anything off your computer.

> **Status: 0.1.0, first release.** Built and tested on **Windows 11 x64**.
> Linux and macOS compile and pass the tests in CI but have not been run yet.
> [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) lists exactly what works, what
> is partial and what is unsupported.

## Download

Windows installers are on the
[Releases page](https://github.com/EngineGames-Development/EngineMonitor/releases/latest).
Use the `…_x64-setup.exe` for a per-user install without administrator rights.
The installers aren't code-signed yet, so Windows SmartScreen may warn you;
[INSTALLATION.md](INSTALLATION.md) explains this and how to check the download.

## Features

- **Live monitoring** pushed from one Rust sampler thread: CPU (total and per
  core), memory and swap, storage volumes and disk I/O, network interfaces and
  traffic, and GPU utilisation and dedicated memory (Windows, via DXGI + PDH,
  matching Task Manager). Values the OS doesn't provide are labelled
  unavailable, never faked.
- **Sections:** Overview, CPU, Memory, GPU, Processes, Storage, Network,
  History and Settings, with keyboard navigation `Ctrl+1` … `Ctrl+9` (`⌘` on macOS).
- **Process manager:** search, sort, filter, details and guarded termination
  (with confirmation; critical system processes are refused).
- **History:** averaged samples in a local SQLite database with configurable
  interval and retention (1–365 days), and charts from 15 minutes to 30 days.
- **Settings:** theme (dark, light, system), refresh interval, live graph
  length, network units (bits/bytes), Overview sections, start minimised and
  launch at login.
- **Low overhead:** about 8 % of one CPU core in total while visible and about
  3 % while minimised, measured on a 4-core Ryzen 3 3200G (release build).
  The backend alone uses under 1 % of one core and about 13 MB of memory.

## Privacy and security

- No network requests, no telemetry, no update checks. History and settings
  stay in a local SQLite file.
- No administrator rights needed, for installing (per-user setup) or running.
- The UI runs under a strict Content Security Policy and can only call an
  explicit allow-list of backend commands, each validated in Rust.

See [SECURITY.md](SECURITY.md) for the security model and how to report a
vulnerability.

## Building from source

Requires Rust 1.95+, Node.js 22.22+ (or 24.15+) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm ci
npm run tauri dev      # run the app in development mode
npx tauri build        # release build with installers
```

Tests:

```bash
npm run typecheck && npm test
cd src-tauri && cargo test
```

## Documentation

| Document | Contents |
|---|---|
| [INSTALLATION.md](INSTALLATION.md) | installing, data locations, uninstalling, building |
| [DEVELOPMENT.md](DEVELOPMENT.md) | setup, commands, testing, performance work |
| [ARCHITECTURE.md](ARCHITECTURE.md) | design, key decisions and their reasons |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | per-feature status, verification and benchmarks |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to report bugs and send pull requests |
| [SECURITY.md](SECURITY.md) | security model and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | release notes |

## License

[MIT](LICENSE) © 2026 EngineGames-Development
