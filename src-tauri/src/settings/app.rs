//! Application settings (theme, refresh, graphs, visibility, startup).
//!
//! `#[serde(default)]` lets settings saved by an older version (with fewer
//! fields) load cleanly; `deny_unknown_fields` rejects anything the frontend
//! should not be able to smuggle in.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::events::sampler::{MAX_INTERVAL, MIN_INTERVAL};
use crate::history::store::{get_setting, put_setting};

pub const APP_KEY: &str = "app";

pub const MIN_LIVE_WINDOW_SECS: u32 = 60;
pub const MAX_LIVE_WINDOW_SECS: u32 = 3_600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NetworkUnit {
    /// kbit/s, Mbit/s (decimal) — how ISPs and link speeds are quoted.
    Bits,
    /// KiB/s, MiB/s (binary) — how file transfers are usually shown.
    Bytes,
}

/// Which optional sections the Overview shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct MetricVisibility {
    pub gpu: bool,
    pub disk: bool,
    pub network: bool,
    pub storage: bool,
}

impl Default for MetricVisibility {
    fn default() -> Self {
        Self {
            gpu: true,
            disk: true,
            network: true,
            storage: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct AppSettings {
    pub theme: Theme,
    /// Live sampling interval while the window is visible.
    pub refresh_interval_ms: u32,
    /// How much live history the real-time graphs keep.
    pub live_window_secs: u32,
    pub network_unit: NetworkUnit,
    /// Draw smoothed (monotone) curves instead of straight segments.
    pub smooth_charts: bool,
    pub visible: MetricVisibility,
    /// Start with the window minimised (useful with launch at login).
    pub start_minimized: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            refresh_interval_ms: 1_000,
            live_window_secs: 300,
            network_unit: NetworkUnit::Bits,
            smooth_charts: true,
            visible: MetricVisibility::default(),
            start_minimized: false,
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> AppResult<()> {
        let (min, max) = (
            MIN_INTERVAL.as_millis() as u32,
            MAX_INTERVAL.as_millis() as u32,
        );
        if !(min..=max).contains(&self.refresh_interval_ms) {
            return Err(AppError::InvalidArgument(format!(
                "refresh interval must be between {min} and {max} ms"
            )));
        }
        if !(MIN_LIVE_WINDOW_SECS..=MAX_LIVE_WINDOW_SECS).contains(&self.live_window_secs) {
            return Err(AppError::InvalidArgument(format!(
                "live graph window must be between {MIN_LIVE_WINDOW_SECS} and {MAX_LIVE_WINDOW_SECS} seconds"
            )));
        }
        Ok(())
    }
}

pub fn load(conn: &Connection) -> AppSettings {
    match get_setting(conn, APP_KEY) {
        Ok(Some(json)) => match serde_json::from_str::<AppSettings>(&json) {
            Ok(s) if s.validate().is_ok() => s,
            _ => {
                eprintln!("EngineMonitor: stored app settings are invalid; using defaults");
                AppSettings::default()
            }
        },
        Ok(None) => AppSettings::default(),
        Err(e) => {
            eprintln!("EngineMonitor: could not read app settings ({e}); using defaults");
            AppSettings::default()
        }
    }
}

pub fn save(conn: &Connection, s: &AppSettings) -> AppResult<()> {
    s.validate()?;
    let json = serde_json::to_string(s).map_err(|e| AppError::Internal(e.to_string()))?;
    put_setting(conn, APP_KEY, &json)
        .map_err(|e| AppError::Internal(format!("could not save settings: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::schema::open_in_memory;

    #[test]
    fn defaults_roundtrip_and_serialisation_shape() {
        let c = open_in_memory().unwrap();
        assert_eq!(load(&c), AppSettings::default());
        let s = AppSettings {
            theme: Theme::Light,
            refresh_interval_ms: 2_000,
            network_unit: NetworkUnit::Bytes,
            visible: MetricVisibility {
                gpu: false,
                ..MetricVisibility::default()
            },
            ..AppSettings::default()
        };
        save(&c, &s).unwrap();
        assert_eq!(load(&c), s);
        let json = serde_json::to_value(s).unwrap();
        assert_eq!(json["theme"], "light");
        assert_eq!(json["networkUnit"], "bytes");
        assert_eq!(json["visible"]["gpu"], false);
    }

    #[test]
    fn validates_ranges() {
        let ok = AppSettings::default();
        assert!(ok.validate().is_ok());
        for bad in [
            AppSettings {
                refresh_interval_ms: 100,
                ..ok
            },
            AppSettings {
                refresh_interval_ms: 60_000,
                ..ok
            },
            AppSettings {
                live_window_secs: 10,
                ..ok
            },
            AppSettings {
                live_window_secs: 7_200,
                ..ok
            },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn older_settings_with_missing_fields_load_with_defaults() {
        let c = open_in_memory().unwrap();
        put_setting(&c, APP_KEY, r#"{"theme":"system"}"#).unwrap();
        let s = load(&c);
        assert_eq!(s.theme, Theme::System);
        assert_eq!(s.refresh_interval_ms, 1_000);
    }

    #[test]
    fn rejects_unknown_fields_and_bad_enums() {
        assert!(serde_json::from_str::<AppSettings>(r#"{"theme":"dark","exe":"x"}"#).is_err());
        assert!(serde_json::from_str::<AppSettings>(r#"{"theme":"purple"}"#).is_err());
        let c = open_in_memory().unwrap();
        put_setting(&c, APP_KEY, r#"{"refreshIntervalMs":5}"#).unwrap();
        assert_eq!(
            load(&c),
            AppSettings::default(),
            "invalid stored value falls back"
        );
    }
}
