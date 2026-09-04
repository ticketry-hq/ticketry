use sea_orm::DbErr;

#[derive(Debug)]
pub enum CommandError {
    NotFound(String),
    Validation {
        message: String,
        field: Option<&'static str>,
    },
    Conflict(String),
    StaleRevision(String),
    InvalidTransition {
        message: String,
        code: &'static str,
        from_state: Option<String>,
        to_state: Option<String>,
    },
    SelfBlocker(String),
    DuplicateBlocker(String),
    BlockerCycle(String),
    ForeignScope(String),
    IllegalBirth {
        message: String,
        to_state: Option<String>,
    },
    Rejected {
        message: String,
        code: &'static str,
        field: Option<&'static str>,
    },
    Storage(String),
    Database(DbErr),
}

impl CommandError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
            field: None,
        }
    }

    pub fn field(field: &'static str, message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
            field: Some(field),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::NotFound(_) => "not_found",
            Self::Validation { field: Some(_), .. } => "field_validation",
            Self::Validation { .. } => "validation",
            Self::Conflict(_) => "conflict",
            Self::StaleRevision(_) => "stale_revision",
            Self::InvalidTransition { code, .. } => code,
            Self::SelfBlocker(_) => "self_blocker",
            Self::DuplicateBlocker(_) => "duplicate_blocker",
            Self::BlockerCycle(_) => "blocker_cycle",
            Self::ForeignScope(_) => "foreign_scope",
            Self::IllegalBirth { .. } => "illegal_birth",
            Self::Rejected { code, .. } => code,
            Self::Storage(_) => "storage_failed",
            Self::Database(_) => "worktracker_storage_failed",
        }
    }

    pub fn field_name(&self) -> Option<&'static str> {
        match self {
            Self::Validation { field, .. } | Self::Rejected { field, .. } => *field,
            _ => None,
        }
    }

    pub fn to_state(&self) -> Option<&str> {
        match self {
            Self::IllegalBirth { to_state, .. } => to_state.as_deref(),
            Self::InvalidTransition { to_state, .. } => to_state.as_deref(),
            _ => None,
        }
    }

    pub fn from_state(&self) -> Option<&str> {
        match self {
            Self::InvalidTransition { from_state, .. } => from_state.as_deref(),
            _ => None,
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(message)
            | Self::Conflict(message)
            | Self::StaleRevision(message)
            | Self::SelfBlocker(message)
            | Self::DuplicateBlocker(message)
            | Self::BlockerCycle(message)
            | Self::ForeignScope(message)
            | Self::Storage(message)
            | Self::Validation { message, .. }
            | Self::Rejected { message, .. }
            | Self::IllegalBirth { message, .. }
            | Self::InvalidTransition { message, .. } => formatter.write_str(message),
            Self::Database(_) => {
                formatter.write_str("The WorkTracker command could not be stored.")
            }
        }
    }
}

impl std::error::Error for CommandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Database(error) => Some(error),
            _ => None,
        }
    }
}

impl From<DbErr> for CommandError {
    fn from(error: DbErr) -> Self {
        Self::Database(error)
    }
}
