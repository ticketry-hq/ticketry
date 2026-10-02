use seaography::CustomOutputType;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::workspace::operations::WorkspaceOperationOutcome;

use super::merge_identity::MergeIntent;
use super::merge_inspection::MergeLocation;
use super::WorktreeChangesError;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeMergePath {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeMergeResult {
    pub operation_id: String,
    pub outcome: String,
    pub source_branch: String,
    pub source_commit: String,
    pub destination_branch: String,
    pub destination_commit: String,
    pub destination_checkout: String,
    pub unmerged_paths: Vec<WorktreeMergePath>,
    pub blocker: Option<String>,
    pub reason: Option<String>,
}

pub(super) fn stale(message: impl Into<String>) -> WorktreeChangesError {
    WorktreeChangesError::merge_blocked("worktree_merge_preview_stale", message)
}

pub(super) fn blocked_failure(error: WorktreeChangesError) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: error.code_str().to_owned(),
        message: error.to_string(),
        retryable: false,
        cleanup_confirmed: true,
    }
}

pub(super) fn unverified_failure(error: WorktreeChangesError) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: error.code_str().to_owned(),
        message: error.to_string(),
        retryable: false,
        cleanup_confirmed: false,
    }
}

pub(super) fn merge_conflict_outcome(
    location: MergeLocation,
    paths: Vec<String>,
) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: "worktree_merge_conflicted".to_owned(),
        message: "The merge has conflicts that require resolution.".to_owned(),
        evidence: json!({
            "destinationCheckout": location.destination,
            "unmergedPaths": paths,
        }),
    }
}

pub(super) fn failure(error: WorktreeChangesError) -> WorkspaceOperationOutcome {
    failed(error.code_str(), error.to_string())
}

pub(super) fn failed(code: &str, message: impl Into<String>) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.into(),
        retryable: true,
        cleanup_confirmed: true,
    }
}

pub(super) fn outcome_name(intent: &MergeIntent) -> &'static str {
    match intent.action.as_str() {
        "fast_forward" => "fast_forwarded",
        "merge" => "merged",
        _ => "already_integrated",
    }
}

pub(super) fn result(
    operation_id: &str,
    intent: &MergeIntent,
    outcome: &str,
    location: MergeLocation,
    unmerged_paths: Vec<WorktreeMergePath>,
) -> WorktreeMergeResult {
    WorktreeMergeResult {
        operation_id: operation_id.to_owned(),
        outcome: outcome.to_owned(),
        source_branch: intent.source_branch.clone(),
        source_commit: intent.source_commit.clone(),
        destination_branch: intent.destination_branch.clone(),
        destination_commit: location.destination_head,
        destination_checkout: location.destination.display().to_string(),
        unmerged_paths,
        blocker: None,
        reason: None,
    }
}

pub(super) fn merge_error_code(code: &str) -> &'static str {
    match code {
        "worktree_merge_preview_stale" => "worktree_merge_preview_stale",
        "worktree_merge_dirty" => "worktree_merge_dirty",
        "worktree_merge_operation_in_progress" => "worktree_merge_operation_in_progress",
        "worktree_merge_divergent_history" => "worktree_merge_divergent_history",
        "worktree_merge_operation_mismatch" => "worktree_merge_operation_mismatch",
        "worktree_merge_git_failed" => "worktree_merge_git_failed",
        _ => "worktree_merge_failed",
    }
}
