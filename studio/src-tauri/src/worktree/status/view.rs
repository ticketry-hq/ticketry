//! The discriminated status contract Studio renders.
//!
//! Absence is data. `none` means the Work Item could have a worktree and does
//! not, so creation can be offered; `no_repo` means it never could, so no
//! control is offered at all; `worktree` carries the live Git facts. Every
//! answer names both the requested Work Item and the top-level owner, so a
//! child can show that it is looking at a shared checkout.

use seaography::CustomOutputType;
use serde::Serialize;

use super::live_facts::LiveFacts;
use super::owner::WorktreeOwner;

pub const KIND_NONE: &str = "none";
pub const KIND_NO_REPO: &str = "no_repo";
pub const KIND_WORKTREE: &str = "worktree";

#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeStatusView {
    /// `none`, `no_repo`, or `worktree`.
    pub kind: String,
    pub task_id: String,
    pub top_level_task_id: String,
    pub is_shared: bool,
    pub branch: Option<String>,
    pub base_branch: Option<String>,
    pub path: Option<String>,
    /// The durable lifecycle state, `active` or `conflict`, reconciled with
    /// what Git currently shows.
    pub state: Option<String>,
    pub clean: Option<bool>,
    pub dirty: Option<bool>,
    pub ahead: Option<i32>,
    pub behind: Option<i32>,
    pub conflict: Option<bool>,
    /// Whether the recorded checkout is still on disk and answering Git.
    pub checkout_present: Option<bool>,
    pub ephemeral: bool,
    pub reason: Option<String>,
}

impl WorktreeStatusView {
    pub(super) fn none(owner: &WorktreeOwner) -> Self {
        Self::absent(owner, KIND_NONE, None)
    }

    pub(super) fn no_repository(owner: &WorktreeOwner, reason: &str) -> Self {
        Self::absent(owner, KIND_NO_REPO, Some(reason.to_owned()))
    }

    pub(super) fn worktree(
        owner: &WorktreeOwner,
        row: &crate::entities::worktrees::worktree::Model,
        facts: LiveFacts,
    ) -> Self {
        Self {
            kind: KIND_WORKTREE.to_owned(),
            task_id: owner.requested_task_id.clone(),
            top_level_task_id: owner.top_level_task_id.clone(),
            is_shared: owner.is_shared,
            branch: Some(row.branch.clone()),
            base_branch: Some(row.base_branch.clone()),
            path: Some(row.path.clone()),
            state: Some(if facts.conflict { "conflict" } else { "active" }.to_owned()),
            clean: Some(facts.clean),
            dirty: Some(facts.dirty),
            ahead: Some(facts.ahead),
            behind: Some(facts.behind),
            conflict: Some(facts.conflict),
            checkout_present: Some(facts.checkout_present),
            ephemeral: row.ephemeral,
            reason: None,
        }
    }

    fn absent(owner: &WorktreeOwner, kind: &str, reason: Option<String>) -> Self {
        Self {
            kind: kind.to_owned(),
            task_id: owner.requested_task_id.clone(),
            top_level_task_id: owner.top_level_task_id.clone(),
            is_shared: owner.is_shared,
            branch: None,
            base_branch: None,
            path: None,
            state: None,
            clean: None,
            dirty: None,
            ahead: None,
            behind: None,
            conflict: None,
            checkout_present: None,
            ephemeral: false,
            reason,
        }
    }
}
