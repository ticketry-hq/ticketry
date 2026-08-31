use sea_orm::DbErr;

use ticketry_work_management::work_management::launch_policy::LaunchPolicyError;

use super::super::WorktreeChangesError;

#[derive(Debug)]
pub struct MergePreparationError {
    code: &'static str,
    message: String,
}

impl MergePreparationError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(super) fn pull_request_missing() -> Self {
        Self::new(
            "merge_preparation_pull_request_missing",
            "This task worktree has no mapped pull request.",
        )
    }

    pub(super) fn worktree_unavailable() -> Self {
        Self::new(
            "merge_preparation_worktree_unavailable",
            "Merge preparation requires an active existing task worktree.",
        )
    }

    pub(super) fn ineligible() -> Self {
        Self::new(
            "merge_preparation_ineligible",
            "Merge preparation is available only for confirmed merge conflicts or failed required checks.",
        )
    }

    pub fn launch_failed(code: String) -> Self {
        Self::new(
            "merge_preparation_launch_failed",
            format!("The merge-preparation agent could not start: {code}."),
        )
    }

    pub fn code_str(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for MergePreparationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MergePreparationError {}

impl From<WorktreeChangesError> for MergePreparationError {
    fn from(error: WorktreeChangesError) -> Self {
        Self::new(error.code_str(), error.to_string())
    }
}

impl From<LaunchPolicyError> for MergePreparationError {
    fn from(error: LaunchPolicyError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<DbErr> for MergePreparationError {
    fn from(error: DbErr) -> Self {
        Self::new(
            "merge_preparation_storage_failed",
            format!("Merge preparation could not read its stored state: {error}"),
        )
    }
}
