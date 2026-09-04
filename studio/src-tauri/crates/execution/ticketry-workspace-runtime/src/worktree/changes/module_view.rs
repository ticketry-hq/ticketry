use seaography::CustomOutputType;
use serde::Serialize;

use super::{ChangedFile, PullRequestStatusView};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct ModuleCheckoutChangesView {
    pub available: bool,
    pub reason: Option<String>,
    pub branch: Option<String>,
    pub default_branch: Option<String>,
    pub committed_count: i32,
    pub pull_request_creation_eligible: bool,
    pub baseline: Option<String>,
    /// `upstream`, `default_merge_base`, or `head`.
    pub baseline_kind: Option<String>,
    pub clean: Option<bool>,
    pub dirty: Option<bool>,
    pub unpushed_count: Option<i32>,
    pub truncated: bool,
    pub files: Vec<ChangedFile>,
}

impl ModuleCheckoutChangesView {
    pub(super) fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            available: false,
            reason: Some(reason.into()),
            branch: None,
            default_branch: None,
            committed_count: 0,
            pull_request_creation_eligible: false,
            baseline: None,
            baseline_kind: None,
            clean: None,
            dirty: None,
            unpushed_count: None,
            truncated: false,
            files: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct CurrentWorktreeView {
    /// `module` or `task`.
    pub kind: String,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_name: Option<String>,
    pub branch: Option<String>,
    pub available: bool,
    pub clean: Option<bool>,
    pub dirty: Option<bool>,
    pub unpushed_count: Option<i32>,
    /// T03 publishes the presentation slot. T05 and T06 add its mapping and
    /// live provider facts without changing this list's read-only contract.
    pub pull_request_state: String,
    pub pull_request: PullRequestStatusView,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct ModuleVersionControlView {
    pub module_id: String,
    pub checkout: ModuleCheckoutChangesView,
    /// The module checkout is always first, followed by active task worktrees.
    pub worktrees: Vec<CurrentWorktreeView>,
    pub worktrees_truncated: bool,
}
