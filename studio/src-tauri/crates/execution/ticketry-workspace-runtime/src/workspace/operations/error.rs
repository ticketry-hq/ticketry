use sea_orm::DbErr;

/// Typed outcomes of the journal protocol. Every one of these is a decision a
/// caller or reconciler can act on; nothing here leaks a storage detail, a
/// local path, or the contents of an intent payload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorkspaceOperationErrorCode {
    /// The submitted identity, resource key, or lease parameters are unusable.
    InvalidIntent,
    /// The operation kind is not in the closed registry of typed kinds.
    UnsupportedKind,
    /// The intent schema version is malformed or is not supported by its kind.
    UnsupportedVersion,
    /// The intent payload carries something the journal refuses to persist.
    ForbiddenPayload,
    /// The operation ID is durable under a different immutable intent.
    FingerprintConflict,
    /// No operation exists under that identity.
    NotFound,
    /// Another worker holds a live lease on the operation.
    Busy,
    /// The reporter does not hold the live lease it is settling under.
    LeaseNotHeld,
    /// The operation already holds a different terminal outcome.
    AlreadySettled,
    Storage,
}

#[derive(Debug)]
pub struct WorkspaceOperationError {
    code: WorkspaceOperationErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl WorkspaceOperationError {
    pub fn new(code: WorkspaceOperationErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(WorkspaceOperationErrorCode::InvalidIntent, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(WorkspaceOperationErrorCode::ForbiddenPayload, message)
    }

    pub fn not_found() -> Self {
        Self::new(
            WorkspaceOperationErrorCode::NotFound,
            "The Workspace Operation does not exist.",
        )
    }

    /// A caller's own half of the settlement transaction refused. The
    /// operation is left exactly as it was, because neither half committed.
    pub fn settlement(message: impl Into<String>) -> Self {
        Self {
            code: WorkspaceOperationErrorCode::Storage,
            message: message.into(),
            source: None,
        }
    }

    pub fn storage(context: &'static str, source: DbErr) -> Self {
        Self {
            code: WorkspaceOperationErrorCode::Storage,
            message: context.to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> WorkspaceOperationErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorkspaceOperationErrorCode::InvalidIntent => "workspace_operation_intent_invalid",
            WorkspaceOperationErrorCode::UnsupportedKind => "workspace_operation_kind_unsupported",
            WorkspaceOperationErrorCode::UnsupportedVersion => {
                "workspace_operation_version_unsupported"
            }
            WorkspaceOperationErrorCode::ForbiddenPayload => {
                "workspace_operation_payload_forbidden"
            }
            WorkspaceOperationErrorCode::FingerprintConflict => {
                "workspace_operation_fingerprint_conflict"
            }
            WorkspaceOperationErrorCode::NotFound => "workspace_operation_not_found",
            WorkspaceOperationErrorCode::Busy => "workspace_operation_busy",
            WorkspaceOperationErrorCode::LeaseNotHeld => "workspace_operation_lease_not_held",
            WorkspaceOperationErrorCode::AlreadySettled => "workspace_operation_already_settled",
            WorkspaceOperationErrorCode::Storage => "workspace_operation_storage_failed",
        }
    }
}

impl std::fmt::Display for WorkspaceOperationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorkspaceOperationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for WorkspaceOperationError {
    fn from(source: DbErr) -> Self {
        Self::storage("Workspace Operation storage failed", source)
    }
}
