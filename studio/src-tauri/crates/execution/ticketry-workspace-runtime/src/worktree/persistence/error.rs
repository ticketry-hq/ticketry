use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorktreePersistenceErrorCode {
    AdoptionUnavailable,
    IncompatibleSchema,
    InvalidMetadata,
    Storage,
}

#[derive(Debug)]
pub struct WorktreePersistenceError {
    code: WorktreePersistenceErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl WorktreePersistenceError {
    pub fn new(code: WorktreePersistenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub fn storage(context: &'static str, source: DbErr) -> Self {
        Self {
            code: WorktreePersistenceErrorCode::Storage,
            message: context.to_owned(),
            source: Some(source),
        }
    }

    pub fn code(&self) -> WorktreePersistenceErrorCode {
        self.code
    }

    /// Stable transport code. Messages describe the failed contract; they never
    /// disclose a rejected checkout path or a raw Git command line.
    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorktreePersistenceErrorCode::AdoptionUnavailable => "worktree_adoption_unavailable",
            WorktreePersistenceErrorCode::IncompatibleSchema => "worktree_schema_incompatible",
            WorktreePersistenceErrorCode::InvalidMetadata => "worktree_metadata_invalid",
            WorktreePersistenceErrorCode::Storage => "worktree_storage_failed",
        }
    }
}

impl std::fmt::Display for WorktreePersistenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorktreePersistenceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for WorktreePersistenceError {
    fn from(source: DbErr) -> Self {
        Self::storage("Worktree storage operation failed", source)
    }
}
