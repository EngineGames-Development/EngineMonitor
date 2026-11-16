//! `Reading<T>`: a value together with *why* it may be missing.
//!
//! `Option` cannot distinguish "this OS does not provide this metric" from
//! "the OS call failed just now". The UI shows these differently
//! (Unsupported vs Error), so metrics with platform-dependent availability use
//! `Reading`.
//!
//! Serialised (internally tagged) as one of:
//! `{ "status": "ok", "value": … }`,
//! `{ "status": "unsupported", "reason": "…" }`,
//! `{ "status": "error", "message": "…" }`,
//! `{ "status": "pending" }` (measured from deltas; needs another sample).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Reading<T> {
    Ok {
        value: T,
    },
    Unsupported {
        reason: String,
    },
    Error {
        message: String,
    },
    /// Derived from the difference between two samples; not available yet.
    Pending,
}

impl<T> Reading<T> {
    pub fn ok(value: T) -> Self {
        Reading::Ok { value }
    }

    pub fn unsupported(reason: impl Into<String>) -> Self {
        Reading::Unsupported {
            reason: reason.into(),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Reading::Error {
            message: message.into(),
        }
    }

    pub fn value(&self) -> Option<&T> {
        match self {
            Reading::Ok { value } => Some(value),
            _ => None,
        }
    }

    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Reading<U> {
        match self {
            Reading::Ok { value } => Reading::Ok { value: f(value) },
            Reading::Unsupported { reason } => Reading::Unsupported { reason },
            Reading::Error { message } => Reading::Error { message },
            Reading::Pending => Reading::Pending,
        }
    }

    /// Converts a `sysinfo` result. `what` names the metric for messages.
    pub fn from_sysinfo(result: Result<T, sysinfo::Error>, what: &str) -> Self {
        match result {
            Ok(value) => Reading::ok(value),
            Err(sysinfo::Error::Unsupported) => Reading::unsupported(format!(
                "{what} is not available on {}",
                std::env::consts::OS
            )),
            Err(e) => Reading::error(format!("could not read {what}: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_with_status_tag() {
        let ok = serde_json::to_value(Reading::ok(1.5)).unwrap();
        assert_eq!(ok, serde_json::json!({ "status": "ok", "value": 1.5 }));
        let un = serde_json::to_value(Reading::<f64>::unsupported("no")).unwrap();
        assert_eq!(
            un,
            serde_json::json!({ "status": "unsupported", "reason": "no" })
        );
        let err = serde_json::to_value(Reading::<f64>::error("boom")).unwrap();
        assert_eq!(
            err,
            serde_json::json!({ "status": "error", "message": "boom" })
        );
    }

    #[test]
    fn maps_sysinfo_unsupported_distinctly_from_errors() {
        let r: Reading<u8> = Reading::from_sysinfo(Err(sysinfo::Error::Unsupported), "load");
        assert!(matches!(r, Reading::Unsupported { .. }));
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let r: Reading<u8> = Reading::from_sysinfo(Err(sysinfo::Error::Io(io)), "load");
        match r {
            Reading::Error { message } => assert!(message.contains("denied")),
            other => panic!("expected error, got {other:?}"),
        }
    }

    #[test]
    fn pending_serialises_without_payload() {
        let p = serde_json::to_value(Reading::<f32>::Pending).unwrap();
        assert_eq!(p, serde_json::json!({ "status": "pending" }));
        assert_eq!(Reading::<u8>::Pending.map(|v| v + 1), Reading::Pending);
    }

    #[test]
    fn map_preserves_non_ok_states() {
        let r: Reading<u32> = Reading::unsupported("x");
        assert_eq!(r.map(|v| v * 2), Reading::unsupported("x"));
        assert_eq!(Reading::ok(2).map(|v| v * 2).value(), Some(&4));
    }
}
