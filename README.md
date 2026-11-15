# EngineMonitor

A cross-platform desktop system monitor built with Rust, Tauri 2 and React.

> **Status: early development (milestone 1 of 7).** The application shell,
> design system, navigation and theming work. **No system metrics are
> collected yet**; every monitoring section says so explicitly. See
> [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for exact progress.

## What works today
- Desktop window with a persistent sidebar for all sections (Overview, CPU,
  Memory, GPU, Processes, Storage, Network, History, Settings).
- Dark and light themes plus "follow system"; the choice is remembered.
- Keyboard navigation: `Ctrl+1` … `Ctrl+9` (`⌘` on macOS).
- Settings → Application shows version and platform info reported by the Rust backend.

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
