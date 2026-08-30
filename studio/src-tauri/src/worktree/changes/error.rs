use sea_orm::DbErr;

use crate::worktree::status::{WorktreeStatusError, WorktreeStatusErrorCode};

#[derive(Debug)]
pub struct WorktreeChangesError {
    code: &'static str,
    message: String,
    detail: Option<String>,
    storage: Option<DbErr>,
}

impl WorktreeChangesError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            storage: None,
        }
    }

    pub(crate) fn not_found() -> Self {
        Self::new(
            "worktree_changes_not_found",
            "This Work Item has no task worktree.",
        )
    }

    pub(crate) fn module_not_found() -> Self {
        Self::new(
            "module_changes_not_found",
            "This module could not be found.",
        )
    }

    pub(crate) fn repository_missing() -> Self {
        Self::new(
            "worktree_changes_repository_missing",
            "The task worktree's repository is missing.",
        )
    }

    pub(crate) fn checkout_missing() -> Self {
        Self::new(
            "worktree_changes_checkout_missing",
            "The task worktree checkout is missing.",
        )
    }

    pub(crate) fn invalid_path() -> Self {
        Self::new(
            "worktree_changes_invalid_path",
            "The task worktree contains an invalid repository path.",
        )
    }

    pub(crate) fn git_state_unavailable(message: impl Into<String>) -> Self {
        Self::new("worktree_changes_git_unavailable", message)
    }

    pub(crate) fn invalid_operation() -> Self {
        Self::new(
            "worktree_command_operation_invalid",
            "The Git command operation identity is invalid.",
        )
    }

    pub(crate) fn invalid_commit_message() -> Self {
        Self::new(
            "worktree_commit_message_invalid",
            "Enter a commit message between 1 and 10,000 characters.",
        )
    }

    pub(crate) fn nothing_to_commit() -> Self {
        Self::new(
            "worktree_commit_no_changes",
            "There is no uncommitted work to commit.",
        )
    }

    pub(crate) fn nothing_to_push() -> Self {
        Self::new("worktree_push_no_commits", "There are no unpushed commits.")
    }

    pub(crate) fn missing_upstream() -> Self {
        Self::new(
            "worktree_push_missing_upstream",
            "No unambiguous Git remote is available for this branch.",
        )
    }

    pub(crate) fn pull_request_no_commits() -> Self {
        Self::new(
            "worktree_pull_request_no_commits",
            "The branch has no committed work for a pull request.",
        )
    }

    pub(crate) fn pull_request_already_mapped() -> Self {
        Self::new(
            "worktree_pull_request_already_mapped",
            "This task worktree already has a mapped pull request.",
        )
    }

    pub(crate) fn pull_request_not_replaceable() -> Self {
        Self::new(
            "worktree_pull_request_not_replaceable",
            "Only a confirmed closed, unmerged pull request can be replaced.",
        )
    }

    pub(crate) fn pull_request_follow_up_ineligible() -> Self {
        Self::new(
            "worktree_pull_request_follow_up_ineligible",
            "A follow-up pull request requires new branch work after a confirmed merge into the recorded base.",
        )
    }

    pub(crate) fn pull_request_ineligible_branch() -> Self {
        Self::new(
            "module_pull_request_ineligible_branch",
            "Check out a non-default branch before creating a pull request.",
        )
    }

    pub(crate) fn github_unavailable() -> Self {
        Self::new(
            "github_cli_unavailable",
            "GitHub pull-request creation is unavailable because gh could not run.",
        )
    }

    pub(crate) fn github_timed_out() -> Self {
        Self::new(
            "github_request_timed_out",
            "GitHub did not answer the pull-request request in time.",
        )
    }

    pub(crate) fn github_authentication_failed() -> Self {
        Self::new(
            "github_authentication_failed",
            "Sign in with gh before creating a pull request.",
        )
    }

    pub(crate) fn github_rejected() -> Self {
        Self::new(
            "github_pull_request_rejected",
            "GitHub rejected the pull-request request.",
        )
    }

    pub(crate) fn github_response_unavailable() -> Self {
        Self::new(
            "github_pull_request_response_unavailable",
            "GitHub's pull-request response was unavailable. No mapping was stored; retry may create a duplicate.",
        )
    }

    pub(crate) fn github_status_unavailable() -> Self {
        Self::new(
            "github_pull_request_status_unavailable",
            "GitHub pull-request status is unavailable.",
        )
    }

    pub(crate) fn git_command_failed(
        code: &'static str,
        message: impl Into<String>,
        detail: &str,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            detail: sanitized_detail(detail),
            storage: None,
        }
    }

    pub fn code_str(&self) -> &'static str {
        self.code
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

impl std::fmt::Display for WorktreeChangesError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(formatter, "{} {detail}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl std::error::Error for WorktreeChangesError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.storage
            .as_ref()
            .map(|source| source as &(dyn std::error::Error + 'static))
    }
}

impl From<DbErr> for WorktreeChangesError {
    fn from(storage: DbErr) -> Self {
        Self {
            code: "worktree_changes_storage_failed",
            message: "The worktree index could not be read.".to_owned(),
            detail: None,
            storage: Some(storage),
        }
    }
}

fn sanitized_detail(detail: &str) -> Option<String> {
    let detail = detail.trim();
    if detail.is_empty() {
        None
    } else {
        Some(crate::workspace::operations::redact_diagnostic(detail))
    }
}

impl From<WorktreeStatusError> for WorktreeChangesError {
    fn from(error: WorktreeStatusError) -> Self {
        match error.code() {
            WorktreeStatusErrorCode::WorkItemNotFound
            | WorktreeStatusErrorCode::WorkItemInvalid => {
                Self::new(error.code_str(), error.to_string())
            }
            WorktreeStatusErrorCode::GitUnavailable => {
                Self::git_state_unavailable(error.to_string())
            }
            WorktreeStatusErrorCode::Storage => Self::new(
                "worktree_changes_storage_failed",
                "The worktree index could not be read.",
            ),
        }
    }
}
