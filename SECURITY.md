# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Please report vulnerabilities **privately**:
[Report a vulnerability](https://github.com/EngineGames-Development/EngineMonitor/security/advisories/new)
(GitHub private vulnerability reporting). Don't open a public issue.

Include what is affected, steps to reproduce and the impact you expect. You
should get a first answer within 7 days. Once a fix is released, the report
can be published with credit to you, if you want.

## Security model

What EngineMonitor is designed to guarantee, so you can tell what counts as a
vulnerability:

- **No network access.** The backend makes no network requests. The WebView
  runs under a strict Content Security Policy (`default-src 'self'`), so the
  UI can't load or send anything to remote hosts.
- **No administrator rights.** Nothing in the app requires elevation. The
  NSIS installer installs per user; only the MSI installs for all users.
- **Minimal IPC surface.** The UI can call only the commands on an explicit
  allow-list (`src-tauri/capabilities/default.json`), and only from the main
  window. No file system, shell, HTTP or opener plugins are included. Every
  command validates its arguments in Rust.
- **Safe process termination.** Ending a process requires the PID and its
  start time, so a reused PID can't be hit by mistake. EngineMonitor refuses
  to end itself, PID 0 and critical system processes, and the UI asks for
  confirmation.
- **Local data only.** History and settings are stored in a SQLite file in
  the user's application data folder. Apart from that, only WebView2's own
  cache folder is written, plus a per-user login item if you turn on
  *Launch at login*.
- **No personal data collection.** The app reads system metrics for display
  and local history only.

Known, documented trade-off: Tauri's `freezePrototype` option is off, because
the chart library can't run with it (see ARCHITECTURE.md). This is acceptable
because no remote content is ever loaded.

The installers are not code-signed; see INSTALLATION.md for how to verify
downloads with the published SHA-256 checksums.
