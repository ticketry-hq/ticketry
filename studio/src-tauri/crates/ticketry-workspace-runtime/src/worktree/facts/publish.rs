//! Appending one versioned worktree fact.
//!
//! The published vocabulary is part of the contract, so the change kinds are
//! stable strings rather than formatted values, and the payload version is
//! bumped rather than reshaped in place: a consumer that cannot read a higher
//! version skips the row instead of guessing at it.
//!
//! A change that leaves the checkout in place is a `worktree.changed`; a change
//! that removes it is a `worktree.deleted`. Both name the same owner, so a
//! consumer converges one holding either way and does not have to know which
//! settlement produced the fact.

use sea_orm::DatabaseTransaction;
use serde_json::json;

use ticketry_runs::{NewStatusEvent, RunsPersistenceError, StatusEventRepository};

use super::scope::WorktreeFactScope;

/// The payload schema worktree facts are written at.
pub const PAYLOAD_VERSION: i32 = 1;

pub const WORKTREE_CHANGED: &str = "worktree.changed";
pub const WORKTREE_DELETED: &str = "worktree.deleted";

/// What kind of settlement produced a fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorktreeChange {
    /// A checkout was cut, or an already-matching one was adopted.
    Created,
    /// A restart finished a settlement that had already changed Git.
    Reconciled,
    /// The checkout was thrown away without landing.
    Discarded,
}

impl WorktreeChange {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Reconciled => "reconciled",
            Self::Discarded => "discarded",
        }
    }

    /// True when the checkout no longer exists after this change.
    pub fn removes(self) -> bool {
        matches!(self, Self::Discarded)
    }

    pub fn event_kind(self) -> &'static str {
        if self.removes() {
            WORKTREE_DELETED
        } else {
            WORKTREE_CHANGED
        }
    }
}

/// What a settlement publishes about the checkout it just committed.
#[derive(Clone, Copy, Debug)]
pub struct WorktreeFact<'a> {
    pub worktree_id: &'a str,
    pub change: WorktreeChange,
    pub branch: Option<&'a str>,
    pub base_branch: Option<&'a str>,
    /// The recorded lifecycle state after the change, when one survives it.
    pub state: Option<&'a str>,
    pub ephemeral: bool,
    /// True when creation adopted an existing checkout rather than cutting one.
    pub adopted: bool,
}

/// Append one worktree fact inside the caller's settlement transaction.
///
/// `events` is optional so a fixture or a composition without the adopted
/// outbox still settles, simply without publishing.
pub async fn record_worktree(
    events: Option<&StatusEventRepository>,
    transaction: &DatabaseTransaction,
    scope: &WorktreeFactScope,
    fact: WorktreeFact<'_>,
) -> Result<(), RunsPersistenceError> {
    let Some(events) = events else {
        return Ok(());
    };
    // No repository root and no checkout path: a fact names identities and
    // refs, and the authoritative status query serves everything on disk.
    let payload = json!({
        "worktreeId": fact.worktree_id,
        "taskId": scope.top_level_task_id,
        "topLevelTaskId": scope.top_level_task_id,
        "changeKind": fact.change.as_str(),
        "removed": fact.change.removes(),
        "branch": fact.branch,
        "baseBranch": fact.base_branch,
        "state": fact.state,
        "ephemeral": fact.ephemeral,
        "adopted": fact.adopted,
    });
    events
        .append(
            transaction,
            NewStatusEvent {
                event_id: &uuid::Uuid::new_v4().simple().to_string(),
                project_id: &scope.project_id,
                event_kind: fact.change.event_kind(),
                payload_version: PAYLOAD_VERSION,
                subject_kind: "worktree",
                subject_id: fact.worktree_id,
                agent_run_id: None,
                automation_attempt_id: None,
                work_item_id: Some(&scope.top_level_row_id),
                payload: &payload,
            },
        )
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_removal_is_published_as_a_deletion() {
        for change in [WorktreeChange::Created, WorktreeChange::Reconciled] {
            assert_eq!(change.event_kind(), WORKTREE_CHANGED);
            assert!(!change.removes());
        }
        assert_eq!(WorktreeChange::Discarded.event_kind(), WORKTREE_DELETED);
        assert!(WorktreeChange::Discarded.removes());
    }

    #[test]
    fn the_published_vocabulary_is_stable() {
        assert_eq!(WorktreeChange::Created.as_str(), "created");
        assert_eq!(WorktreeChange::Reconciled.as_str(), "reconciled");
        assert_eq!(WorktreeChange::Discarded.as_str(), "discarded");
    }
}
