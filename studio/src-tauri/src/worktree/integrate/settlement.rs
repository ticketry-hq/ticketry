//! What commits when Git has proved the landing.
//!
//! Two settlements exist, and both write the model row, the durable fact, and
//! the operation's outcome in one SQLite transaction:
//!
//! * A **landing** deletes the index row and publishes one `worktree.deleted`
//!   fact. It runs only after ancestry proved the base contains the branch and
//!   after the checkout and the branch are gone, so the bookkeeping can never
//!   get ahead of the repository.
//! * A **conflict** keeps the row and marks it `conflict`, so the checkout
//!   stays visible with its half-finished merge intact and the next completion
//!   can retry the landing.
//!
//! Nothing here decides anything. Both are handed a result the executor
//! already proved, which is why a rolled-back settlement publishes no fact.

use chrono::{SecondsFormat, Utc};
use sea_orm::{sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter};

use crate::entities::worktrees::worktree;
use crate::runs_persistence::StatusEventRepository;
use crate::worktree::facts::{self, WorktreeChange, WorktreeFact, WorktreeFactScope};

use super::error::{WorktreeIntegrateError, WorktreeIntegrateErrorCode};
use super::plan::IntegrationPlan;

/// The recorded lifecycle state of a checkout holding an unresolved merge.
pub(crate) const CONFLICT: &str = "conflict";

/// Delete the index row for a checkout that has landed and is gone.
pub(crate) async fn delete_row(
    transaction: &DatabaseTransaction,
    plan: &IntegrationPlan,
) -> Result<(), WorktreeIntegrateError> {
    worktree::Entity::delete_many()
        .filter(worktree::Column::Id.eq(plan.worktree_id.as_str()))
        .filter(worktree::Column::TaskId.eq(plan.top_level_row_id.as_str()))
        .exec(transaction)
        .await
        .map(|_| ())
        .map_err(|_| storage("The worktree index row could not be removed."))
}

/// Record that a landing stopped inside the checkout.
pub(crate) async fn mark_conflict(
    transaction: &DatabaseTransaction,
    plan: &IntegrationPlan,
) -> Result<(), WorktreeIntegrateError> {
    worktree::Entity::update_many()
        .filter(worktree::Column::Id.eq(plan.worktree_id.as_str()))
        .filter(worktree::Column::TaskId.eq(plan.top_level_row_id.as_str()))
        .col_expr(worktree::Column::Status, Expr::value(CONFLICT))
        .col_expr(
            worktree::Column::UpdatedAt,
            Expr::value(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false)),
        )
        .exec(transaction)
        .await
        .map(|_| ())
        .map_err(|_| storage("The worktree conflict state could not be recorded."))
}

/// Publish one worktree fact for a settled integration.
///
/// The scope is resolved from the Work Item graph rather than from the row, so
/// a fact always reaches the project and the owner it actually concerns. It is
/// resolved before the settlement opens — the graph is not what the settlement
/// changes — and a scope that could not be resolved publishes nothing rather
/// than aiming a fact at a guessed project.
pub(crate) async fn append_fact(
    events: Option<&StatusEventRepository>,
    transaction: &DatabaseTransaction,
    plan: &IntegrationPlan,
    scope: Option<&WorktreeFactScope>,
    change: WorktreeChange,
) -> Result<(), WorktreeIntegrateError> {
    let Some(scope) = scope else {
        return Ok(());
    };
    facts::record_worktree(
        events,
        transaction,
        scope,
        WorktreeFact {
            worktree_id: &plan.worktree_id,
            change,
            branch: Some(&plan.branch),
            base_branch: Some(&plan.base_ref),
            state: (!change.removes()).then_some(CONFLICT),
            ephemeral: plan.ephemeral,
            adopted: false,
        },
    )
    .await
    .map_err(|_| storage("The worktree fact could not be published."))
}

fn storage(message: &str) -> WorktreeIntegrateError {
    WorktreeIntegrateError::new(WorktreeIntegrateErrorCode::Storage, message)
}
