//! Persisted settings.
//!
//! Stored as JSON values in the `settings` table of the history database
//! (key per settings group). Invalid or missing values fall back to defaults
//! instead of failing start-up; the reason is logged.
//!
//! Groups: `history` (this module) and `app` ([`app`]).

pub mod app;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::history::store::{get_setting, put_setting};

pub const HISTORY_KEY: &str = "history";

pub const MIN_HISTORY_INTERVAL_SECS: u32 = 1;
pub const MAX_HISTORY_INTERVAL_SECS: u32 = 3_600;
pub const MIN_RETENTION_DAYS: u32 = 1;
pub const MAX_RETENTION_DAYS: u32 = 365;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySettings {
    /// Record history at all.
    pub enabled: bool,
    /// Length of one recording window; live ticks inside it are averaged.
    pub interval_secs: u32,
    /// Rows older than this are deleted.
    pub retention_days: u32,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: 5,
            retention_days: 7,
        }
    }
}

impl HistorySettings {
    pub fn validate(&self) -> AppResult<()> {
        if !(MIN_HISTORY_INTERVAL_SECS..=MAX_HISTORY_INTERVAL_SECS).contains(&self.interval_secs) {
            return Err(AppError::InvalidArgument(format!(
                "history interval must be between {MIN_HISTORY_INTERVAL_SECS} and {MAX_HISTORY_INTERVAL_SECS} seconds"
            )));
        }
        if !(MIN_RETENTION_DAYS..=MAX_RETENTION_DAYS).contains(&self.retention_days) {
            return Err(AppError::InvalidArgument(format!(
                "retention must be between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days"
            )));
        }
        Ok(())
    }

    /// Estimated database size at full retention, bytes (≈ 100 B per row
    /// including index overhead, measured order of magnitude).
    pub fn estimated_size_bytes(&self) -> u64 {
        let rows = u64::from(self.retention_days) * 86_400 / u64::from(self.interval_secs.max(1));
        rows * 100
    }
}

pub fn load_history(conn: &Connection) -> HistorySettings {
    match get_setting(conn, HISTORY_KEY) {
        Ok(Some(json)) => match serde_json::from_str::<HistorySettings>(&json) {
            Ok(s) if s.validate().is_ok() => s,
            Ok(_) | Err(_) => {
                eprintln!("EngineMonitor: stored history settings are invalid; using defaults");
                HistorySettings::default()
            }
        },
        Ok(None) => HistorySettings::default(),
        Err(e) => {
            eprintln!("EngineMonitor: could not read history settings ({e}); using defaults");
            HistorySettings::default()
        }
    }
}

pub fn save_history(conn: &Connection, s: &HistorySettings) -> AppResult<()> {
    s.validate()?;
    let json = serde_json::to_string(s).map_err(|e| AppError::Internal(e.to_string()))?;
    put_setting(conn, HISTORY_KEY, &json)
        .map_err(|e| AppError::Internal(format!("could not save settings: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::schema::open_in_memory;

    #[test]
    fn defaults_when_missing_and_roundtrip() {
        let c = open_in_memory().unwrap();
        assert_eq!(load_history(&c), HistorySettings::default());
        let s = HistorySettings {
            enabled: false,
            interval_secs: 30,
            retention_days: 90,
        };
        save_history(&c, &s).unwrap();
        assert_eq!(load_history(&c), s);
    }

    #[test]
    fn validation_bounds() {
        let ok = HistorySettings::default();
        assert!(ok.validate().is_ok());
        assert!(HistorySettings {
            interval_secs: 0,
            ..ok
        }
        .validate()
        .is_err());
        assert!(HistorySettings {
            interval_secs: 3_601,
            ..ok
        }
        .validate()
        .is_err());
        assert!(HistorySettings {
            retention_days: 0,
            ..ok
        }
        .validate()
        .is_err());
        assert!(HistorySettings {
            retention_days: 366,
            ..ok
        }
        .validate()
        .is_err());
    }

    #[test]
    fn invalid_stored_values_fall_back_to_defaults() {
        let c = open_in_memory().unwrap();
        put_setting(&c, HISTORY_KEY, "{not json").unwrap();
        assert_eq!(load_history(&c), HistorySettings::default());
        put_setting(
            &c,
            HISTORY_KEY,
            r#"{"enabled":true,"intervalSecs":0,"retentionDays":7}"#,
        )
        .unwrap();
        assert_eq!(load_history(&c), HistorySettings::default());
        put_setting(
            &c,
            HISTORY_KEY,
            r#"{"enabled":true,"intervalSecs":5,"retentionDays":7,"evil":1}"#,
        )
        .unwrap();
        assert_eq!(load_history(&c), HistorySettings::default());
    }

    #[test]
    fn rejects_saving_invalid_settings() {
        let c = open_in_memory().unwrap();
        let bad = HistorySettings {
            retention_days: 0,
            ..HistorySettings::default()
        };
        assert!(matches!(
            save_history(&c, &bad),
            Err(AppError::InvalidArgument(_))
        ));
        assert_eq!(load_history(&c), HistorySettings::default());
    }

    #[test]
    fn size_estimate_scales_with_settings() {
        let s = HistorySettings::default(); // 5 s, 7 days
        assert_eq!(s.estimated_size_bytes(), 7 * 86_400 / 5 * 100);
    }
}
