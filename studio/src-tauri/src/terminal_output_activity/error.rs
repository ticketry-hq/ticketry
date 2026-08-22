use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalOutputActivityErrorCode {
    InvalidIdentity,
    NotAuthorized,
    CaptureFailed,
    StorageFailed,
}

impl TerminalOutputActivityErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidIdentity => "terminal_output_identity_invalid",
            Self::NotAuthorized => "terminal_output_not_authorized",
            Self::CaptureFailed => "terminal_output_capture_failed",
            Self::StorageFailed => "terminal_output_storage_failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalOutputActivityError {
    code: TerminalOutputActivityErrorCode,
    message: String,
}

impl TerminalOutputActivityError {
    pub(crate) fn new(code: TerminalOutputActivityErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> TerminalOutputActivityErrorCode {
        self.code
    }
}

impl fmt::Display for TerminalOutputActivityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalOutputActivityError {}

impl From<sea_orm::DbErr> for TerminalOutputActivityError {
    fn from(_: sea_orm::DbErr) -> Self {
        Self::new(
            TerminalOutputActivityErrorCode::StorageFailed,
            "Terminal output activity could not be recorded.",
        )
    }
}

impl From<crate::runs_persistence::RunsPersistenceError> for TerminalOutputActivityError {
    fn from(_: crate::runs_persistence::RunsPersistenceError) -> Self {
        Self::new(
            TerminalOutputActivityErrorCode::StorageFailed,
            "Terminal output activity could not be recorded.",
        )
    }
}
