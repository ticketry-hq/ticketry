//! The typed failures of a worktree discard.
//!
//! Absence is not a failure: a Work Item that has no checkout is answered with
//! an ordinary `removed: false`. These errors are reserved for a request that
//! cannot be answered at all, and for external state that contradicts what the
//! operation intended — which is always reported, never overwritten.
//!
//! Messages describe the failed contract. They never disclose a checkout path,
//! a module folder, or a raw Git command line: Git's own diagnostic is
//! redacted through the journal's rules before it is repeated here.

use sea_orm::DbErr;

use crate::workspace::operations::{WorkspaceOperationError, WorkspaceOperationErrorCode};
use crate::worktree::status::{WorktreeStatusError, WorktreeStatusErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorktreeDiscardErrorCode {
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
    /// Studio did not send the user's explicit cleanup confirmation.
    CleanupConfirmationRequired,
    /// Live workflow, provider, or Git facts no longer allow cleanup.
    CleanupIneligible,
}

#[derive(Debug)]
pub struct WorktreeDiscardError {
    code: WorktreeDiscardErrorCode,
    message: String,
    /// The sanitized external reason, when there is one worth showing.
    detail: Option<String>,
}

impl WorktreeDiscardError {
    pub fn new(code: WorktreeDiscardErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    /// A Git command ran and refused. The diagnostic rides along redacted, so
    /// "is not a working tree" survives while a local path does not.
    pub fn git_failed(message: impl Into<String>, detail: &str) -> Self {
        Self {
            code: WorktreeDiscardErrorCode::GitFailed,
            message: message.into(),
            detail: sanitized_detail(detail),
        }
    }

    pub fn external_conflict(code: &str, detail: &str) -> Self {
        Self {
            code: WorktreeDiscardErrorCode::ExternalConflict,
            message: format!("The worktree could not be discarded ({code})."),
            detail: sanitized_detail(detail),
        }
    }

    pub fn cleanup_confirmation_required() -> Self {
        Self::new(
            WorktreeDiscardErrorCode::CleanupConfirmationRequired,
            "Confirm cleanup before removing the local task worktree.",
        )
    }

    pub fn cleanup_ineligible() -> Self {
        Self::new(
            WorktreeDiscardErrorCode::CleanupIneligible,
            "This task worktree no longer satisfies every cleanup precondition.",
        )
    }

    pub fn code(&self) -> WorktreeDiscardErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorktreeDiscardErrorCode::WorkItemNotFound => "worktree_work_item_not_found",
            WorktreeDiscardErrorCode::WorkItemInvalid => "worktree_work_item_invalid",
            WorktreeDiscardErrorCode::GitUnavailable => "worktree_git_unavailable",
            WorktreeDiscardErrorCode::GitFailed => "worktree_git_failed",
            WorktreeDiscardErrorCode::OperationReplayMismatch => {
                "worktree_operation_replay_mismatch"
            }
            WorktreeDiscardErrorCode::OperationBusy => "worktree_operation_busy",
            WorktreeDiscardErrorCode::ExternalConflict => "worktree_external_conflict",
            WorktreeDiscardErrorCode::OperationInvalid => "worktree_operation_invalid",
            WorktreeDiscardErrorCode::Storage => "worktree_discard_storage_failed",
            WorktreeDiscardErrorCode::CleanupConfirmationRequired => {
                "worktree_cleanup_confirmation_required"
            }
            WorktreeDiscardErrorCode::CleanupIneligible => "worktree_cleanup_ineligible",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self.code,
            WorktreeDiscardErrorCode::GitUnavailable
                | WorktreeDiscardErrorCode::GitFailed
                | WorktreeDiscardErrorCode::OperationBusy
                | WorktreeDiscardErrorCode::Storage
        )
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

impl std::fmt::Display for WorktreeDiscardError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{} {detail}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for WorktreeDiscardError {}

impl From<DbErr> for WorktreeDiscardError {
    fn from(_: DbErr) -> Self {
        Self::new(
            WorktreeDiscardErrorCode::Storage,
            "The worktree index could not be read or written.",
        )
    }
}

impl From<WorktreeStatusError> for WorktreeDiscardError {
    fn from(error: WorktreeStatusError) -> Self {
        let code = match error.code() {
            WorktreeStatusErrorCode::WorkItemNotFound => WorktreeDiscardErrorCode::WorkItemNotFound,
            WorktreeStatusErrorCode::WorkItemInvalid => WorktreeDiscardErrorCode::WorkItemInvalid,
            WorktreeStatusErrorCode::GitUnavailable => WorktreeDiscardErrorCode::GitUnavailable,
            WorktreeStatusErrorCode::Storage => WorktreeDiscardErrorCode::Storage,
        };
        Self::new(code, error.to_string())
    }
}

impl From<WorkspaceOperationError> for WorktreeDiscardError {
    fn from(error: WorkspaceOperationError) -> Self {
        let code = match error.code() {
            WorkspaceOperationErrorCode::FingerprintConflict => {
                WorktreeDiscardErrorCode::OperationReplayMismatch
            }
            WorkspaceOperationErrorCode::Busy
            | WorkspaceOperationErrorCode::LeaseNotHeld
            | WorkspaceOperationErrorCode::AlreadySettled => {
                WorktreeDiscardErrorCode::OperationBusy
            }
            WorkspaceOperationErrorCode::Storage => WorktreeDiscardErrorCode::Storage,
            _ => WorktreeDiscardErrorCode::OperationInvalid,
        };
        Self::new(code, error.to_string())
    }
}
