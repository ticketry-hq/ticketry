use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalCleanupErrorCode {
    InvalidRequest,
    NotFound,
    Conflict,
    EffectBusy,
    RuntimeUnavailable,
    RuntimeIdentityConflict,
    CleanupPending,
    Storage,
}

#[derive(Debug)]
pub struct TerminalCleanupError {
    code: TerminalCleanupErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl TerminalCleanupError {
    pub(crate) fn new(code: TerminalCleanupErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub(crate) fn storage(source: DbErr) -> Self {
        Self {
            code: TerminalCleanupErrorCode::Storage,
            message: "Terminal cleanup storage failed.".to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> TerminalCleanupErrorCode {
        self.code
    }

    #[doc(hidden)]
    pub fn injected_checkpoint() -> Self {
        Self::new(
            TerminalCleanupErrorCode::Storage,
            "Terminal cleanup stopped at an injected checkpoint.",
        )
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            TerminalCleanupErrorCode::InvalidRequest => "terminal_cleanup_invalid",
            TerminalCleanupErrorCode::NotFound => "terminal_session_not_found",
            TerminalCleanupErrorCode::Conflict => "terminal_cleanup_conflict",
            TerminalCleanupErrorCode::EffectBusy => "terminal_cleanup_busy",
            TerminalCleanupErrorCode::RuntimeUnavailable => "terminal_runtime_unavailable",
            TerminalCleanupErrorCode::RuntimeIdentityConflict => {
                "terminal_runtime_identity_conflict"
            }
            TerminalCleanupErrorCode::CleanupPending => "terminal_cleanup_pending",
            TerminalCleanupErrorCode::Storage => "terminal_cleanup_storage_failed",
        }
    }
}

impl std::fmt::Display for TerminalCleanupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalCleanupError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source.as_ref().map(|source| source as _)
    }
}

impl From<DbErr> for TerminalCleanupError {
    fn from(source: DbErr) -> Self {
        Self::storage(source)
    }
}

impl From<crate::runs_persistence::RunsPersistenceError> for TerminalCleanupError {
    fn from(_: crate::runs_persistence::RunsPersistenceError) -> Self {
        Self::new(
            TerminalCleanupErrorCode::Storage,
            "Terminal cleanup could not settle its Agent Run.",
        )
    }
}
