//! The typed failures of a worktree creation.
//!
//! Absence is not a failure: a Work Item whose module has no configured folder
//! or no enclosing repository is answered with the ordinary `no_repo` status.
//! These errors are reserved for a request that cannot be answered at all, and
//! for external state that contradicts what the operation intended.
//!
//! Messages describe the failed contract. They never disclose a checkout path,
//! a module folder, or a raw Git command line — Git's own diagnostic is
//! redacted through the journal's rules before it is repeated here.

use sea_orm::DbErr;

use crate::workspace::operations::{WorkspaceOperationError, WorkspaceOperationErrorCode};
use crate::worktree::status::{WorktreeStatusError, WorktreeStatusErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorktreeCreateErrorCode {
    /// The requested Work Item does not exist, or is archived.
    WorkItemNotFound,
    /// The requested identity exists but can never own a worktree.
    WorkItemInvalid,
    /// Git could not be run, so nothing external could be observed.
    GitUnavailable,
    /// Git ran and refused the effect.
    GitFailed,
    /// The operation identity is already durable under different intent.
    OperationReplayMismatch,
    /// Another worker is acting on this operation right now.
    OperationBusy,
    /// External state contradicts the intent and is left untouched.
    ExternalConflict,
    /// The recovery journal itself refused the request.
    OperationInvalid,
    /// The database refused a read or write.
    Storage,
}

#[derive(Debug)]
pub struct WorktreeCreateError {
    code: WorktreeCreateErrorCode,
    message: String,
    /// The sanitized external reason, when there is one worth showing.
    detail: Option<String>,
}

impl WorktreeCreateError {
    pub(crate) fn new(code: WorktreeCreateErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    pub(crate) fn work_item_not_found() -> Self {
        Self::new(
            WorktreeCreateErrorCode::WorkItemNotFound,
            "No active Work Item matches that identity.",
        )
    }

    /// A Git command ran and refused. The diagnostic rides along redacted, so
    /// "already exists" survives while a local path does not.
    pub(crate) fn git_failed(message: impl Into<String>, detail: &str) -> Self {
        Self {
            code: WorktreeCreateErrorCode::GitFailed,
            message: message.into(),
            detail: sanitized_detail(detail),
        }
    }

    pub(crate) fn external_conflict(code: &str, detail: &str) -> Self {
        Self {
            code: WorktreeCreateErrorCode::ExternalConflict,
            message: format!("The worktree could not be created ({code})."),
            detail: sanitized_detail(detail),
        }
    }

    pub fn code(&self) -> WorktreeCreateErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorktreeCreateErrorCode::WorkItemNotFound => "worktree_work_item_not_found",
            WorktreeCreateErrorCode::WorkItemInvalid => "worktree_work_item_invalid",
            WorktreeCreateErrorCode::GitUnavailable => "worktree_git_unavailable",
            WorktreeCreateErrorCode::GitFailed => "worktree_git_failed",
            WorktreeCreateErrorCode::OperationReplayMismatch => {
                "worktree_operation_replay_mismatch"
            }
            WorktreeCreateErrorCode::OperationBusy => "worktree_operation_busy",
            WorktreeCreateErrorCode::ExternalConflict => "worktree_external_conflict",
            WorktreeCreateErrorCode::OperationInvalid => "worktree_operation_invalid",
            WorktreeCreateErrorCode::Storage => "worktree_create_storage_failed",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

/// Git's own words, bounded and stripped of anything that looks like a local
/// path, using the same rule the durable journal applies to evidence.
fn sanitized_detail(detail: &str) -> Option<String> {
    let detail = detail.trim();
    if detail.is_empty() {
        return None;
    }
    Some(crate::workspace::operations::redact_diagnostic(detail))
}

impl std::fmt::Display for WorktreeCreateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{} {detail}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for WorktreeCreateError {}

impl From<DbErr> for WorktreeCreateError {
    fn from(_: DbErr) -> Self {
        Self::new(
            WorktreeCreateErrorCode::Storage,
            "The worktree index could not be read or written.",
        )
    }
}

impl From<WorktreeStatusError> for WorktreeCreateError {
    fn from(error: WorktreeStatusError) -> Self {
        let code = match error.code() {
            WorktreeStatusErrorCode::WorkItemNotFound => WorktreeCreateErrorCode::WorkItemNotFound,
            WorktreeStatusErrorCode::WorkItemInvalid => WorktreeCreateErrorCode::WorkItemInvalid,
            WorktreeStatusErrorCode::GitUnavailable => WorktreeCreateErrorCode::GitUnavailable,
            WorktreeStatusErrorCode::Storage => WorktreeCreateErrorCode::Storage,
        };
        Self::new(code, error.to_string())
    }
}

impl From<WorkspaceOperationError> for WorktreeCreateError {
    fn from(error: WorkspaceOperationError) -> Self {
        let code = match error.code() {
            WorkspaceOperationErrorCode::FingerprintConflict => {
                WorktreeCreateErrorCode::OperationReplayMismatch
            }
            WorkspaceOperationErrorCode::Busy
            | WorkspaceOperationErrorCode::LeaseNotHeld
            | WorkspaceOperationErrorCode::AlreadySettled => WorktreeCreateErrorCode::OperationBusy,
            WorkspaceOperationErrorCode::Storage => WorktreeCreateErrorCode::Storage,
            _ => WorktreeCreateErrorCode::OperationInvalid,
        };
        Self::new(code, error.to_string())
    }
}
