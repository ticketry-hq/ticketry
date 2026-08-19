//! The result contract Studio renders after a confirmed discard.
//!
//! Two facts are worth reporting and both are here: whether this request is
//! what removed the checkout, and what the Work Item's worktree status is now.
//! The status is the same discriminated contract the live status query serves,
//! so the window that confirmed does not have to refetch to be correct — and a
//! window that refetches anyway gets the same answer.
//!
//! `removed: false` is an ordinary result, not an error. A Work Item that has
//! no checkout has nothing to discard, and saying so is more useful than a
//! failure a user would have to interpret.

use seaography::CustomOutputType;
use serde::Serialize;

use crate::worktree_status::WorktreeStatusView;

/// Why a discard removed nothing.
pub const NO_WORKTREE: &str = "no worktree for this Work Item";

#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeDiscardResult {
    /// True when a checkout this workspace indexed was removed — by this
    /// request, or by the earlier attempt of this same operation whose durable
    /// result is being replayed.
    pub removed: bool,
    pub task_id: String,
    pub top_level_task_id: String,
    /// The task branch that was deleted, when there was one.
    pub branch: Option<String>,
    /// Why nothing was removed, when nothing was.
    pub reason: Option<String>,
    /// The authoritative worktree status of the Work Item after the discard.
    pub status: WorktreeStatusView,
}

impl WorktreeDiscardResult {
    pub(crate) fn removed(branch: Option<String>, status: WorktreeStatusView) -> Self {
        Self {
            removed: true,
            task_id: status.task_id.clone(),
            top_level_task_id: status.top_level_task_id.clone(),
            branch,
            reason: None,
            status,
        }
    }

    /// The answer a durable operation result describes. An applied discard
    /// that removed nothing — because another window's discard had already
    /// finished — is reported as truthfully as one that did.
    pub(crate) fn settled(result: &serde_json::Value, status: WorktreeStatusView) -> Self {
        match result["removed"].as_bool().unwrap_or(true) {
            true => Self::removed(result["branch"].as_str().map(str::to_owned), status),
            false => Self::absent(status),
        }
    }

    pub(crate) fn absent(status: WorktreeStatusView) -> Self {
        Self {
            removed: false,
            task_id: status.task_id.clone(),
            top_level_task_id: status.top_level_task_id.clone(),
            branch: None,
            reason: Some(NO_WORKTREE.to_owned()),
            status,
        }
    }
}
