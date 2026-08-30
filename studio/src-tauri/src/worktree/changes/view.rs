use seaography::CustomOutputType;
use serde::Serialize;

use super::PullRequestStatusView;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct ChangedFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeChangesView {
    pub task_id: String,
    pub top_level_task_id: String,
    pub is_shared: bool,
    pub base_commit: String,
    pub committed_count: i32,
    pub pull_request_url: Option<String>,
    pub pull_request: PullRequestStatusView,
    pub pull_request_creation_eligible: bool,
    pub work_item_done: bool,
    pub closure_failure: Option<WorkItemClosureFailureView>,
    pub cleanup: WorktreeCleanupStatusView,
    pub clean: bool,
    pub dirty: bool,
    pub unpushed_count: i32,
    pub truncated: bool,
    pub files: Vec<ChangedFile>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorkItemClosureFailureView {
    pub code: String,
    pub message: String,
    pub from_state: Option<String>,
    pub to_state: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeCleanupStatusView {
    pub eligible: bool,
    pub blocker: Option<String>,
    pub reason: Option<String>,
}

impl WorktreeCleanupStatusView {
    pub(super) fn eligible() -> Self {
        Self {
            eligible: true,
            blocker: None,
            reason: None,
        }
    }

    pub(super) fn blocked(blocker: &str, reason: &str) -> Self {
        Self {
            eligible: false,
            blocker: Some(blocker.to_owned()),
            reason: Some(reason.to_owned()),
        }
    }
}
