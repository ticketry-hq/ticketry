use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewerOwnershipErrorCode {
    InvalidIdentity,
    InvalidTransport,
    MechanicsNotPrepared,
    MechanicsFailed,
    AgentRunNotFound,
    LeaseNotOwned,
    Storage,
}

impl ViewerOwnershipErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidIdentity => "invalid_identity",
            Self::InvalidTransport => "invalid_transport",
            Self::MechanicsNotPrepared => "viewer_mechanics_not_prepared",
            Self::MechanicsFailed => "viewer_mechanics_failed",
            Self::AgentRunNotFound => "agent_run_not_found",
            Self::LeaseNotOwned => "viewer_lease_not_owned",
            Self::Storage => "viewer_lease_storage_failed",
        }
    }
}

#[derive(Debug)]
pub struct ViewerOwnershipError {
    code: ViewerOwnershipErrorCode,
    message: String,
}

impl ViewerOwnershipError {
    pub fn new(code: ViewerOwnershipErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> ViewerOwnershipErrorCode {
        self.code
    }

    pub(crate) fn storage(error: sea_orm::DbErr) -> Self {
        Self::new(
            ViewerOwnershipErrorCode::Storage,
            format!("viewer ownership storage failed: {error}"),
        )
    }
}

impl fmt::Display for ViewerOwnershipError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ViewerOwnershipError {}
