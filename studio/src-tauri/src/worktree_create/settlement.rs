//! What commits when Git has proved the checkout.
//!
//! The index row and its durable fact are written inside the Workspace
//! Operation's own settlement transaction, so the three either all exist or
//! none do. Bookkeeping can therefore never get ahead of the repository: the
//! row is inserted only after Git has shown the exact checkout on the exact
//! branch, and the fact is appended only with the row.

use chrono::{SecondsFormat, Utc};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, DatabaseTransaction};
use serde_json::json;

use crate::entities::worktrees::worktree;
use crate::runs_persistence::StatusEventRepository;
use crate::worktree_facts::{record_worktree, WorktreeChange, WorktreeFact, WorktreeFactScope};

use super::error::{WorktreeCreateError, WorktreeCreateErrorCode};
use super::plan::CreatePlan;

/// The persisted lifecycle state of a freshly created checkout.
const ACTIVE: &str = "active";

/// The row a settlement writes, and the summary a replayed operation returns.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SettledWorktree {
    pub(crate) worktree_id: String,
    pub(crate) base_ref: String,
    pub(crate) base_commit: String,
    /// True when the checkout already existed and was adopted rather than cut.
    pub(crate) adopted: bool,
}

impl SettledWorktree {
    /// The durable, replayable result. It names relative identities only: a
    /// checkout path is recomposed, never remembered.
    pub(crate) fn result(&self, plan: &CreatePlan) -> serde_json::Value {
        json!({
            "worktreeId": self.worktree_id,
            "taskId": plan.owner.top_level_row_id(),
            "branch": plan.branch,
            "checkoutName": plan.checkout_name,
            "baseRef": self.base_ref,
            "baseCommit": self.base_commit,
            "adopted": self.adopted,
        })
    }
}

/// Insert the index row for a proved checkout. Runs inside the settlement
/// transaction; a failure aborts it and leaves the operation unsettled.
pub(crate) async fn insert_row(
    transaction: &DatabaseTransaction,
    plan: &CreatePlan,
    settled: &SettledWorktree,
) -> Result<(), WorktreeCreateError> {
    let stamp = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false);
    worktree::ActiveModel {
        id: Set(settled.worktree_id.clone()),
        task_id: Set(plan.owner.top_level_row_id()),
        workspace_slug: Set(plan.workspace_slug.clone()),
        project_id: Set(plan.project_id.clone()),
        module_id: Set(plan.owner.module_id.as_deref().map(compact)),
        ticket_seq: Set(plan.ticket_seq),
        repo_root: Set(plan.repository.display().to_string()),
        path: Set(plan.checkout.display().to_string()),
        branch: Set(plan.branch.clone()),
        base_branch: Set(settled.base_ref.clone()),
        base_commit: Set(settled.base_commit.clone()),
        status: Set(ACTIVE.to_owned()),
        ephemeral: Set(false),
        created_at: Set(stamp.clone()),
        updated_at: Set(stamp),
    }
    .insert(transaction)
    .await
    .map(|_| ())
    .map_err(|_| {
        WorktreeCreateError::new(
            WorktreeCreateErrorCode::Storage,
            "The worktree index row could not be written.",
        )
    })
}

/// Append the durable `worktree.changed` fact for a created checkout.
///
/// The shared fact seam owns the vocabulary, the payload version, and the
/// addressing; creation supplies only what it just committed. The scope is
/// resolved out of the Work Item graph before the transaction opens, so a
/// creation asked for by a child publishes under the top-level owner that
/// actually holds the checkout.
pub(crate) async fn append_fact(
    events: Option<&StatusEventRepository>,
    transaction: &DatabaseTransaction,
    scope: Option<&WorktreeFactScope>,
    plan: &CreatePlan,
    settled: &SettledWorktree,
) -> Result<(), WorktreeCreateError> {
    let Some(scope) = scope else {
        return Ok(());
    };
    record_worktree(
        events,
        transaction,
        scope,
        WorktreeFact {
            worktree_id: &settled.worktree_id,
            change: WorktreeChange::Created,
            branch: Some(&plan.branch),
            base_branch: Some(&settled.base_ref),
            state: Some(ACTIVE),
            ephemeral: false,
            adopted: settled.adopted,
        },
    )
    .await
    .map_err(|_| {
        WorktreeCreateError::new(
            WorktreeCreateErrorCode::Storage,
            "The worktree fact could not be published.",
        )
    })
}

fn compact(identity: &str) -> String {
    crate::worktree_status::identity::compact_uuid(identity)
}
