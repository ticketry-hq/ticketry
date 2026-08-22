use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum RunsPersistenceErrorCode {
    AdoptionUnavailable,
    IncompatibleSchema,
    InvalidHistory,
    InvalidLaunchIntent,
    InvalidAttempt,
    AttemptNotFound,
    AttemptNotFailed,
    AttemptNotRetryable,
    InvalidTimestamp,
    InvalidLifecycleFact,
    InvalidProviderSession,
    NotFound,
    Unauthorized,
    Conflict,
    LaunchConflict,
    LaunchEffectNotFound,
    LaunchLeaseNotHeld,
    Storage,
}

#[derive(Debug)]
pub struct RunsPersistenceError {
    code: RunsPersistenceErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl RunsPersistenceError {
    pub(crate) fn new(code: RunsPersistenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub(crate) fn storage(context: &'static str, source: DbErr) -> Self {
        Self {
            code: RunsPersistenceErrorCode::Storage,
            message: context.to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> RunsPersistenceErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            RunsPersistenceErrorCode::AdoptionUnavailable => "runs_adoption_unavailable",
            RunsPersistenceErrorCode::IncompatibleSchema => "runs_schema_incompatible",
            RunsPersistenceErrorCode::InvalidHistory => "runs_history_invalid",
            RunsPersistenceErrorCode::InvalidLaunchIntent => "launch_intent_invalid",
            RunsPersistenceErrorCode::InvalidAttempt => "automation_attempt_invalid",
            RunsPersistenceErrorCode::AttemptNotFound => "automation_attempt_not_found",
            RunsPersistenceErrorCode::AttemptNotFailed => "automation_attempt_not_failed",
            RunsPersistenceErrorCode::AttemptNotRetryable => "automation_attempt_not_retryable",
            RunsPersistenceErrorCode::InvalidTimestamp => "timestamp_invalid",
            RunsPersistenceErrorCode::InvalidLifecycleFact => "lifecycle_fact_invalid",
            RunsPersistenceErrorCode::InvalidProviderSession => "provider_session_invalid",
            RunsPersistenceErrorCode::NotFound => "agent_run_not_found",
            RunsPersistenceErrorCode::Unauthorized => "caller_run_unbound",
            RunsPersistenceErrorCode::Conflict => "runs_conflict",
            RunsPersistenceErrorCode::LaunchConflict => "launch_conflict",
            RunsPersistenceErrorCode::LaunchEffectNotFound => "launch_effect_not_found",
            RunsPersistenceErrorCode::LaunchLeaseNotHeld => "launch_lease_not_held",
            RunsPersistenceErrorCode::Storage => "runs_storage_failed",
        }
    }
}

impl std::fmt::Display for RunsPersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RunsPersistenceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for RunsPersistenceError {
    fn from(source: DbErr) -> Self {
        Self::storage("Runs storage operation failed", source)
    }
}
