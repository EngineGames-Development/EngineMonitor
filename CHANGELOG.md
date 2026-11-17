# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-17

First public release. Built and tested on Windows 11 x64.

### Added
- **Live monitoring** from a single Rust sampler thread, pushed to the UI as
  events: CPU total and per core, memory and swap, storage volumes with disk
  I/O, network interfaces and traffic, and GPU utilisation and dedicated
  memory (Windows: own DXGI + PDH provider, matching Task Manager).
- **Sections:** Overview, CPU, Memory, GPU, Processes, Storage, Network,
  History and Settings, with `Ctrl+1` … `Ctrl+9` navigation.
- **Process manager:** search, sort, filter, a virtualised list, details and
  guarded termination with confirmation.
- **History:** averaged samples (with CPU peak) in a local SQLite database,
  configurable interval and retention, charts from 15 minutes to 30 days.
- **Settings:** dark/light/system theme, refresh interval, live graph length,
  network units, Overview sections, start minimised, launch at login.
- **Low overhead:** the sampler slows to 5 s while the window is minimised;
  Windows network counters are read directly (3 ms instead of 20 ms per update).
- Windows installers: per-user NSIS setup and per-machine MSI.

### Known limitations
- Linux and macOS are compiled and tested in CI but haven't been run.
- GPU and CPU temperatures aren't available; NVIDIA-specific data (NVML)
  isn't implemented.
- The installers aren't code-signed.

See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for the full list.

[0.1.0]: https://github.com/EngineGames-Development/EngineMonitor/releases/tag/v0.1.0
