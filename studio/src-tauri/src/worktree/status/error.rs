//! The typed failures of a worktree status read.
//!
//! Absence is not a failure here. A Work Item with no worktree, no configured
//! folder, or no enclosing repository is answered with a normal discriminated
//! result. These errors are reserved for the cases where nothing authoritative
//! could be observed at all. Messages describe the failed contract; they never
//! disclose a checkout path, a module folder, or a raw Git command line.

use sea_orm::DbErr;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorktreeStatusErrorCode {
    /// The requested Work Item does not exist, or is archived.
    WorkItemNotFound,
    /// The requested identity exists but can never own a worktree.
    WorkItemInvalid,
    /// Git could not be run, so no live fact could be observed.
    GitUnavailable,
    /// The database refused the read.
    Storage,
}

#[derive(Debug)]
pub struct WorktreeStatusError {
    code: WorktreeStatusErrorCode,
    message: String,
    source: Option<DbErr>,
}

impl WorktreeStatusError {
    pub(crate) fn new(code: WorktreeStatusErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            source: None,
        }
    }

    pub(crate) fn work_item_not_found() -> Self {
        Self::new(
            WorktreeStatusErrorCode::WorkItemNotFound,
            "No active Work Item matches that identity.",
        )
    }

    pub(crate) fn work_item_invalid(message: impl Into<String>) -> Self {
        Self::new(WorktreeStatusErrorCode::WorkItemInvalid, message)
    }

    pub(crate) fn git_unavailable(message: impl Into<String>) -> Self {
        Self::new(WorktreeStatusErrorCode::GitUnavailable, message)
    }

    pub fn code(&self) -> WorktreeStatusErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorktreeStatusErrorCode::WorkItemNotFound => "worktree_work_item_not_found",
            WorktreeStatusErrorCode::WorkItemInvalid => "worktree_work_item_invalid",
            WorktreeStatusErrorCode::GitUnavailable => "worktree_git_unavailable",
            WorktreeStatusErrorCode::Storage => "worktree_status_storage_failed",
        }
    }
}

impl std::fmt::Display for WorktreeStatusError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorktreeStatusError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for WorktreeStatusError {
    fn from(source: DbErr) -> Self {
        Self {
            code: WorktreeStatusErrorCode::Storage,
            message: "The worktree index could not be read.".to_owned(),
            source: Some(source),
        }
    }
}
