//! Launch at login, always for the current user only.
//!
//! Uses the `auto-launch` crate directly instead of `tauri-plugin-autostart`.
//! The plugin's Windows default first tries the machine-wide `HKLM` Run key and
//! falls back to the per-user key only when that is denied, so an elevated
//! EngineMonitor would have registered itself for every user, and the plugin
//! offers no way to change that. Here the mode is fixed to the current user.
//! Disabling also removes a machine-wide entry where the process is allowed to.
//!
//! Where the entry lives: Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
//! macOS `~/Library/LaunchAgents`, Linux `~/.config/autostart` (XDG).

use std::path::Path;

use auto_launch::{AutoLaunch, AutoLaunchBuilder};

use crate::error::{AppError, AppResult};

/// The path the OS should start at login.
fn launch_path(exe: &Path) -> String {
    // An AppImage runs from a temporary mount; the stable path is the image.
    #[cfg(target_os = "linux")]
    if let Some(image) = std::env::var_os("APPIMAGE") {
        return image.to_string_lossy().into_owned();
    }
    exe.display().to_string()
}

/// Builds the per-user login item for the given app name and executable.
pub fn login_item_for(app_name: &str, exe: &Path) -> AppResult<AutoLaunch> {
    let mut builder = AutoLaunchBuilder::new();
    builder
        .set_app_name(app_name)
        .set_app_path(&launch_path(exe));
    #[cfg(windows)]
    builder.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    #[cfg(target_os = "macos")]
    builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    builder
        .build()
        .map_err(|e| AppError::Unsupported(format!("launch at login is not available: {e}")))
}

/// The login item for the running executable.
pub fn login_item(app_name: &str) -> AppResult<AutoLaunch> {
    let exe = std::env::current_exe().map_err(|e| {
        AppError::Internal(format!("could not locate EngineMonitor's executable: {e}"))
    })?;
    login_item_for(app_name, &exe)
}

pub fn is_enabled(item: &AutoLaunch) -> AppResult<bool> {
    item.is_enabled()
        .map_err(|e| AppError::Internal(format!("could not read the login item: {e}")))
}

/// Registers or removes the login item and returns the state read back.
pub fn set_enabled(item: &AutoLaunch, enabled: bool) -> AppResult<bool> {
    let result = if enabled {
        item.enable()
    } else {
        item.disable()
    };
    result.map_err(|e| AppError::Internal(format!("could not change the login item: {e}")))?;
    is_enabled(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_an_item_for_the_running_executable() {
        let item = login_item("EngineMonitor").expect("login item");
        assert_eq!(item.get_app_name(), "EngineMonitor");
        assert!(!item.get_app_path().is_empty());
        // Reading must work without elevation.
        is_enabled(&item).expect("read state");
    }

    /// Registers and removes a login item under a separate test name (never
    /// EngineMonitor's own entry). Ignored by default because it writes to the
    /// user's login items for a moment; run with
    /// `cargo test autostart -- --ignored`.
    #[test]
    #[ignore = "touches the real per-user login items (with a test name)"]
    fn enable_and_disable_round_trip_for_the_current_user() {
        struct Cleanup(AutoLaunch);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.disable();
            }
        }
        let exe = std::env::current_exe().unwrap();
        let item = Cleanup(login_item_for("EngineMonitor-selftest", &exe).unwrap());
        assert!(set_enabled(&item.0, true).unwrap(), "enabled after enable");
        assert!(
            !set_enabled(&item.0, false).unwrap(),
            "disabled after disable"
        );
    }
}
