//! The typed failures of a launch path resolution.
//!
//! An unresolvable directory is not one of them. No configured module folder,
//! a folder that has moved, a worktree row whose checkout is gone, a document
//! that is no longer registered — all of those are ordinary results that leave
//! the launch rooted where it was before, and are reported as data.
//!
//! These errors are reserved for a request that cannot be honoured at all.
//! Their messages name the failed contract and never disclose a local path.

use sea_orm::DbErr;

use ticketry_workspace_runtime::status::{WorktreeStatusError, WorktreeStatusErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum LaunchPathsErrorCode {
    /// The contract version is not one this runtime speaks.
    UnsupportedVersion,
    /// A required identity is missing for the requested scope.
    IdentityRequired,
    /// The requested Work Item does not exist, or is archived.
    WorkItemNotFound,
    /// The identity exists but cannot root a run of this scope.
    WorkItemInvalid,
    /// The submitted module is not the module that owns the Work Item.
    ModuleMismatch,
    /// The database refused the read.
    Storage,
}

#[derive(Debug)]
pub struct LaunchPathsError {
    code: LaunchPathsErrorCode,
    message: String,
}

impl LaunchPathsError {
    pub(super) fn new(code: LaunchPathsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(super) fn unsupported_version() -> Self {
        Self::new(
            LaunchPathsErrorCode::UnsupportedVersion,
            "This runtime does not speak that launch path contract version.",
        )
    }

    pub(super) fn identity_required(message: impl Into<String>) -> Self {
        Self::new(LaunchPathsErrorCode::IdentityRequired, message)
    }

    pub(super) fn module_mismatch() -> Self {
        Self::new(
            LaunchPathsErrorCode::ModuleMismatch,
            "The submitted module does not own that Work Item.",
        )
    }

    pub fn code(&self) -> LaunchPathsErrorCode {
        self.code
    }

    pub fn code_str(&self) -> &'static str {
        match self.code {
            LaunchPathsErrorCode::UnsupportedVersion => "launch_paths_unsupported_version",
            LaunchPathsErrorCode::IdentityRequired => "launch_paths_identity_required",
            LaunchPathsErrorCode::WorkItemNotFound => "launch_paths_work_item_not_found",
            LaunchPathsErrorCode::WorkItemInvalid => "launch_paths_work_item_invalid",
            LaunchPathsErrorCode::ModuleMismatch => "launch_paths_module_mismatch",
            LaunchPathsErrorCode::Storage => "launch_paths_storage_failed",
        }
    }
}

impl std::fmt::Display for LaunchPathsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for LaunchPathsError {}

impl From<DbErr> for LaunchPathsError {
    fn from(error: DbErr) -> Self {
        Self::new(LaunchPathsErrorCode::Storage, error.to_string())
    }
}

/// Ownership resolution is shared with the worktree capability, so its
/// failures are re-expressed here rather than leaking a second error contract
/// into the compatibility boundary.
impl From<WorktreeStatusError> for LaunchPathsError {
    fn from(error: WorktreeStatusError) -> Self {
        let code = match error.code() {
            WorktreeStatusErrorCode::WorkItemNotFound => LaunchPathsErrorCode::WorkItemNotFound,
            WorktreeStatusErrorCode::WorkItemInvalid => LaunchPathsErrorCode::WorkItemInvalid,
            _ => LaunchPathsErrorCode::Storage,
        };
        Self::new(code, error.to_string())
    }
}
