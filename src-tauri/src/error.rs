//! Application error type.
//!
//! Errors returned from commands are serialised as `{ kind, message }` so the
//! frontend can branch on `kind` without parsing free-form text.

use serde::{ser::SerializeStruct, Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The frontend sent a value that failed validation.
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    /// The requested metric or operation is not available on this system.
    #[error("unsupported: {0}")]
    Unsupported(String),
    /// The OS denied the operation (e.g. protected process).
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    /// Anything else; the message is shown to the user verbatim.
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::InvalidArgument(_) => "invalid_argument",
            AppError::Unsupported(_) => "unsupported",
            AppError::PermissionDenied(_) => "permission_denied",
            AppError::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_kind_and_message() {
        let err = AppError::InvalidArgument("interval must be >= 250 ms".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "invalid_argument");
        assert_eq!(
            json["message"],
            "invalid argument: interval must be >= 250 ms"
        );
    }

    #[test]
    fn every_variant_has_distinct_kind() {
        let kinds = [
            AppError::InvalidArgument(String::new()).kind(),
            AppError::Unsupported(String::new()).kind(),
            AppError::PermissionDenied(String::new()).kind(),
            AppError::Internal(String::new()).kind(),
        ];
        let mut sorted = kinds.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), kinds.len());
    }
}
