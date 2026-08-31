//! What commits when Git holds none of the discarded checkout any more.
//!
//! The row is deleted and its durable fact appended inside the Workspace
//! Operation's own settlement transaction, so the three either all happen or
//! none do. The database therefore never claims a checkout is gone before Git
//! agrees, and never keeps indexing one Git has already released.
//!
//! The delete is bound to the row's own identity *and* its owning Work Item.
//! It is not a filtered sweep and cannot reach a second row.

use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter};
use serde_json::json;

use crate::runs_persistence::StatusEventRepository;
use crate::worktree::facts::{self, WorktreeChange, WorktreeFact, WorktreeFactScope};
use ticketry_entities::worktrees::worktree;

use super::error::{WorktreeDiscardError, WorktreeDiscardErrorCode};
use super::plan::DiscardPlan;

/// Which of the three removal steps this attempt actually performed. Steps a
/// previous attempt already completed are absent rather than repeated.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct Removal {
    pub(crate) checkout_removed: bool,
    pub(crate) pruned: bool,
    pub(crate) branch_deleted: bool,
}

impl Removal {
    /// The durable, replayable result. A caller reusing the operation identity
    /// receives exactly this, so a lost response is answered from the journal
    /// rather than by discarding a second time. It names relative identities
    /// only: a checkout path is recomposed, never remembered.
    pub(crate) fn result(&self, plan: &DiscardPlan) -> serde_json::Value {
        json!({
            "removed": true,
            "worktreeId": plan.worktree_id,
            "taskId": plan.top_level_row_id,
            "branch": plan.branch,
            "checkoutName": plan.checkout_name,
            "checkoutRemoved": self.checkout_removed,
            "pruned": self.pruned,
            "branchDeleted": self.branch_deleted,
        })
    }
}

/// Delete the exact indexed row. Runs inside the settlement transaction; a
/// failure aborts it and leaves the operation unsettled.
pub(crate) async fn delete_row(
    transaction: &DatabaseTransaction,
    plan: &DiscardPlan,
) -> Result<(), WorktreeDiscardError> {
    worktree::Entity::delete_many()
        .filter(worktree::Column::Id.eq(plan.worktree_id.as_str()))
        .filter(worktree::Column::TaskId.eq(plan.top_level_row_id.as_str()))
        .exec(transaction)
        .await
        .map(|_| ())
        .map_err(|_| storage("The worktree index row could not be deleted."))
}

/// Publish the durable `worktree.deleted` fact for a discarded checkout.
///
/// The scope is resolved from the Work Item graph rather than from the row, so
/// the fact reaches the project and the owner it actually concerns. It is
/// resolved before the settlement opens — the graph is not what the settlement
/// changes — and a scope that could not be resolved publishes nothing rather
/// than aiming a fact at a guessed project.
pub(crate) async fn append_fact(
    events: Option<&StatusEventRepository>,
    transaction: &DatabaseTransaction,
    plan: &DiscardPlan,
    scope: Option<&WorktreeFactScope>,
) -> Result<(), WorktreeDiscardError> {
    let Some(scope) = scope else {
        return Ok(());
    };
    facts::record_worktree(
        events,
        transaction,
        scope,
        WorktreeFact {
            worktree_id: &plan.worktree_id,
            change: WorktreeChange::Discarded,
            branch: Some(&plan.branch),
            base_branch: Some(&plan.base_ref),
            // No lifecycle state survives a discard.
            state: None,
            ephemeral: plan.ephemeral,
            adopted: false,
        },
    )
    .await
    .map_err(|_| storage("The worktree deletion fact could not be published."))
}

fn storage(message: &str) -> WorktreeDiscardError {
    WorktreeDiscardError::new(WorktreeDiscardErrorCode::Storage, message)
}
