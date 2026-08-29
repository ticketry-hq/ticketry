//! The typed failures of an automatic integration.
//!
//! Integration is a background consequence of completing a Work Item, so most
//! of what can go wrong is *data*: a Work Item with no checkout, a checkout
//! whose module is no longer configured, a tree with uncommitted work. Those
//! are answers, not errors. These errors are reserved for the driver itself
//! being unable to ask the question at all.
//!
//! Messages describe the failed contract. They never disclose a checkout path,
//! a module folder, or a raw Git command line: Git's own diagnostic is
//! redacted through the journal's rules before it is repeated here.

use sea_orm::DbErr;

use crate::workspace::operations::{WorkspaceOperationError, WorkspaceOperationErrorCode};
use crate::worktree::status::{WorktreeStatusError, WorktreeStatusErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum WorktreeIntegrateErrorCode {
    /// The completing Work Item does not exist, or is archived.
    WorkItemNotFound,
    /// The identity exists but can never own a worktree.
    WorkItemInvalid,
    /// Git could not be run, so nothing external could be observed.
    GitUnavailable,
    /// Git ran and refused an effect.
    GitFailed,
    /// The recovery journal refused the request.
    OperationInvalid,
    /// The database refused a read or write.
    Storage,
}

#[derive(Debug)]
pub struct WorktreeIntegrateError {
    code: WorktreeIntegrateErrorCode,
    message: String,
    detail: Option<String>,
}

impl WorktreeIntegrateError {
    pub(crate) fn new(code: WorktreeIntegrateErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    /// A Git command ran and refused. The diagnostic rides along redacted, so
    /// "not fully merged" survives while a local path does not.
    pub(crate) fn git_failed(message: impl Into<String>, detail: &str) -> Self {
        Self {
            code: WorktreeIntegrateErrorCode::GitFailed,
            message: message.into(),
            detail: sanitized_detail(detail),
        }
    }

    pub fn code(&self) -> WorktreeIntegrateErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            WorktreeIntegrateErrorCode::WorkItemNotFound => "worktree_work_item_not_found",
            WorktreeIntegrateErrorCode::WorkItemInvalid => "worktree_work_item_invalid",
            WorktreeIntegrateErrorCode::GitUnavailable => "worktree_git_unavailable",
            WorktreeIntegrateErrorCode::GitFailed => "worktree_git_failed",
            WorktreeIntegrateErrorCode::OperationInvalid => "worktree_operation_invalid",
            WorktreeIntegrateErrorCode::Storage => "worktree_integrate_storage_failed",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

fn sanitized_detail(detail: &str) -> Option<String> {
    let detail = detail.trim();
    if detail.is_empty() {
        return None;
    }
    Some(crate::workspace::operations::redact_diagnostic(detail))
}

impl std::fmt::Display for WorktreeIntegrateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{} {detail}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for WorktreeIntegrateError {}

impl From<DbErr> for WorktreeIntegrateError {
    fn from(_: DbErr) -> Self {
        Self::new(
            WorktreeIntegrateErrorCode::Storage,
            "The worktree index could not be read or written.",
        )
    }
}

impl From<WorktreeStatusError> for WorktreeIntegrateError {
    fn from(error: WorktreeStatusError) -> Self {
        let code = match error.code() {
            WorktreeStatusErrorCode::WorkItemNotFound => {
                WorktreeIntegrateErrorCode::WorkItemNotFound
            }
            WorktreeStatusErrorCode::WorkItemInvalid => WorktreeIntegrateErrorCode::WorkItemInvalid,
            WorktreeStatusErrorCode::GitUnavailable => WorktreeIntegrateErrorCode::GitUnavailable,
            WorktreeStatusErrorCode::Storage => WorktreeIntegrateErrorCode::Storage,
        };
        Self::new(code, error.to_string())
    }
}

impl From<WorkspaceOperationError> for WorktreeIntegrateError {
    fn from(error: WorkspaceOperationError) -> Self {
        let code = match error.code() {
            WorkspaceOperationErrorCode::Storage => WorktreeIntegrateErrorCode::Storage,
            _ => WorktreeIntegrateErrorCode::OperationInvalid,
        };
        Self::new(code, error.to_string())
    }
}
