use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalReconciliationErrorCode {
    Storage,
    Launch,
    Cleanup,
    InjectedStop,
}

#[derive(Debug)]
pub struct TerminalReconciliationError {
    code: TerminalReconciliationErrorCode,
    message: String,
}

impl TerminalReconciliationError {
    pub fn new(code: TerminalReconciliationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> TerminalReconciliationErrorCode {
        self.code
    }

    pub fn injected_checkpoint() -> Self {
        Self::new(
            TerminalReconciliationErrorCode::InjectedStop,
            "Terminal reconciliation stopped at an injected checkpoint.",
        )
    }
}

impl fmt::Display for TerminalReconciliationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TerminalReconciliationError {}

impl From<sea_orm::DbErr> for TerminalReconciliationError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::new(TerminalReconciliationErrorCode::Storage, error.to_string())
    }
}

impl From<ticketry_runs::persistence::RunsPersistenceError> for TerminalReconciliationError {
    fn from(error: ticketry_runs::persistence::RunsPersistenceError) -> Self {
        Self::new(TerminalReconciliationErrorCode::Storage, error.to_string())
    }
}

impl From<crate::launch::terminal_session::TerminalLaunchError> for TerminalReconciliationError {
    fn from(error: crate::launch::terminal_session::TerminalLaunchError) -> Self {
        Self::new(TerminalReconciliationErrorCode::Launch, error.to_string())
    }
}

impl From<crate::terminal::cleanup::TerminalCleanupError> for TerminalReconciliationError {
    fn from(error: crate::terminal::cleanup::TerminalCleanupError) -> Self {
        Self::new(TerminalReconciliationErrorCode::Cleanup, error.to_string())
    }
}
