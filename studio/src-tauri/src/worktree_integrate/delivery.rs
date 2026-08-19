//! Which committed transitions ask for an integration.
//!
//! Nobody presses a button to land a checkout. The request is a *fact*: one
//! committed transition occurrence carrying a top-level Work Item into a
//! completed workflow-state group. Reading the request from that durable fact,
//! rather than from an in-process signal, is what makes the trigger survive a
//! restart and what makes re-delivery harmless.
//!
//! Three rules keep the queue exact:
//!
//! * **Completed, not merely terminal.** A cancelled Work Item is finished and
//!   is deliberately not landed; its checkout is left for a person to discard.
//!   The occurrence's destination group is what decides, so no state name is
//!   ever matched by spelling.
//! * **The owner, not a participant.** The queue only considers occurrences
//!   whose Work Item *is* an indexed checkout's owner. A child shares its
//!   parent's checkout, so completing the child names no row and is an
//!   ordinary no-op rather than a filtered special case.
//! * **The occurrence, not the moment.** The operation identity is derived from
//!   the Work Item and the occurrence, so re-delivery converges on the same
//!   durable operation and a genuinely new completion — the retry after a
//!   hand-resolved conflict — is a genuinely new one.

use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};

use crate::entities::work_management::transition_occurrence;
use crate::entities::worktrees::worktree;

use super::error::WorktreeIntegrateError;

/// The workflow-state group that asks for a landing.
pub(crate) const COMPLETED_GROUP: &str = "completed";

/// What one delivery did with its occurrence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DeliveryOutcome {
    /// The checkout landed: the base advanced, the checkout and branch are
    /// gone, and the row was removed with its durable fact.
    Integrated,
    /// The landing stopped, or external state contradicted it. The checkout is
    /// intact and a later completion may retry.
    Conflicted { code: String },
    /// The landing was refused without touching anything — a dirty or
    /// ephemeral checkout.
    Refused { code: String },
    /// The operation this occurrence keys was already durable, so its recorded
    /// outcome is the answer rather than a second attempt.
    Replayed { state: String },
    /// Another worker holds the operation, or it needs another pass.
    Deferred { reason: String },
}

/// One delivered completion occurrence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntegrationDelivery {
    pub occurrence_id: String,
    /// The top-level Work Item whose checkout this delivery is about.
    pub task_id: String,
    pub operation_id: String,
    pub outcome: DeliveryOutcome,
}

/// Committed completion occurrences whose Work Item owns an indexed checkout.
///
/// The membership test is a subquery rather than a join so the answer is
/// exactly "does a row exist for this Work Item right now" — the same question
/// the delivery re-asks before it prepares anything.
pub(crate) async fn pending(
    database: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<transition_occurrence::Model>, WorktreeIntegrateError> {
    Ok(transition_occurrence::Entity::find()
        .filter(transition_occurrence::Column::ToGroup.eq(COMPLETED_GROUP))
        .filter(
            transition_occurrence::Column::IssueId.in_subquery(
                worktree::Entity::find()
                    .select_only()
                    .column(worktree::Column::TaskId)
                    .into_query(),
            ),
        )
        .order_by_asc(transition_occurrence::Column::CommittedAt)
        .order_by_asc(transition_occurrence::Column::OccurrenceId)
        .limit(limit)
        .all(database)
        .await?)
}

/// One occurrence by identity, for a caller delivering a single completion it
/// has just committed.
pub(crate) async fn occurrence(
    database: &DatabaseConnection,
    occurrence_id: &str,
) -> Result<Option<transition_occurrence::Model>, WorktreeIntegrateError> {
    Ok(transition_occurrence::Entity::find_by_id(occurrence_id)
        .one(database)
        .await?)
}
