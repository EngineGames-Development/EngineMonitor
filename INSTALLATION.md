# Installing EngineMonitor

EngineMonitor is a desktop app. Version 0.1.0 has been built and tested on
**Windows 11 x64** only (Windows 10 with WebView2 should work but is untested). Linux and macOS builds are compiled and tested by
CI, but the app has not been run on those systems; see
[Other platforms](#other-platforms).

## Windows

Download one of these from the
[Releases page](https://github.com/EngineGames-Development/EngineMonitor/releases):

| File | Installs for | Needs administrator rights |
|---|---|---|
| `EngineMonitor_<version>_x64-setup.exe` (NSIS, **recommended**) | the current user (`%LOCALAPPDATA%\EngineMonitor`) | No |
| `EngineMonitor_<version>_x64_en-US.msi` | all users (`C:\Program Files\EngineMonitor`) | Yes, to install |

Both create Start menu and desktop shortcuts.
Running EngineMonitor never needs administrator rights, whichever installer
you use.

### "Windows protected your PC"
The installers are **not code-signed** (a signing certificate costs money and
has not been bought for this project). So Microsoft Defender SmartScreen may
warn you the first time. Choose **More info → Run anyway** only if you
downloaded the file from the Releases page above. You can check the file
against the SHA-256 checksums published with each release:

```powershell
Get-FileHash .\EngineMonitor_0.1.0_x64-setup.exe -Algorithm SHA256
```

### WebView2
EngineMonitor draws its window with Microsoft Edge WebView2, which is part of
Windows 11 and of current Windows 10 installations. If it is missing, the
installer downloads Microsoft's WebView2 bootstrapper and installs it.

### Where your data is stored
Everything stays on your computer. EngineMonitor makes no network requests.

| What | Where |
|---|---|
| History and settings (SQLite) | `%APPDATA%\dev.enginemonitor.desktop\history.sqlite3` |
| WebView cache | `%LOCALAPPDATA%\dev.enginemonitor.desktop\` |

You can clear the history from **History → Clear history** or
**Settings → Recording & retention**.

### Launch at login
**Settings → Startup → Launch at login** adds a per-user login item (the
registry key `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`). Turning it
off removes the entry. Windows also lists it under
**Task Manager → Startup apps**.

### Uninstalling
Use **Settings → Apps → Installed apps → EngineMonitor → Uninstall** (or
**Apps & features** on Windows 10). The uninstaller removes the program and
its Start menu and desktop shortcuts, but keeps your history and settings, so
a reinstall picks them up again. To remove them too, delete the folders listed
above. If you turned on *Launch at login*, turn it off in EngineMonitor before
uninstalling.

## Other platforms

There are no Linux or macOS packages yet. Building from source should work
(CI compiles the code and runs the tests on Ubuntu and macOS), but the app has
not been run on those systems, and GPU data there comes from an unverified
provider. Please report what you find.

## Building from source

Requirements:
- [Rust](https://rustup.rs) 1.95 or newer
- [Node.js](https://nodejs.org) 22.22+ or 24.15+ (needed for the tests; building alone works with 22.12+)
- Tauri's platform prerequisites: <https://tauri.app/start/prerequisites/>
  (Windows: Microsoft C++ Build Tools and WebView2; Linux: WebKitGTK 4.1 and
  related packages)

```bash
git clone https://github.com/EngineGames-Development/EngineMonitor.git
cd EngineMonitor
npm ci
npx tauri build              # installers in src-tauri/target/release/bundle/
npx tauri build --no-bundle  # just the executable: src-tauri/target/release/
```

A release build takes several minutes (link-time optimisation) and needs a
few GB of free disk space in `src-tauri/target/`. The first `tauri build` on
Windows downloads the NSIS and WiX tools that create the installers.
