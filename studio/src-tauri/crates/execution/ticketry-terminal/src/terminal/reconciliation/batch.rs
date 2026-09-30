//! The recorded terminal rows one reconciliation pass judges. Rows whose
//! durable state can still change are scanned before settled tombstones, so a
//! long history never delays an active session's decision.

use sea_orm::{sea_query::Condition, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use ticketry_entities::session;

use super::TerminalReconciliationError;

/// Rows whose durable state can still change: live sessions and tombstones
/// still owing runtime cleanup.
fn changeable_tier() -> Condition {
    Condition::any()
        .add(session::Column::TerminatedAt.is_null())
        .add(session::Column::RuntimeCleanupPending.eq(true))
}

/// Settled tombstones. A tombstone whose runtime is still running has to be
/// recovered, so every one of them is judged too — against the same listing,
/// at no extra runtime cost.
fn settled_tier() -> Condition {
    Condition::all()
        .add(session::Column::TerminatedAt.is_not_null())
        .add(session::Column::RuntimeCleanupPending.eq(false))
}

/// Both tiers, in scan order. One pass now costs one tmux listing however many
/// rows it judges, so the whole history is read at once and tombstone recovery
/// completes in a single pass instead of walking a cursor across launches.
///
// ponytail: whole-table read per pass; restore a keyset walk if a real
// installation ever records enough sessions for the read itself to matter.
pub(super) async fn recorded_session_batch(
    database: &DatabaseConnection,
) -> Result<Vec<session::Model>, TerminalReconciliationError> {
    let mut rows = read_tier(database, changeable_tier()).await?;
    rows.extend(read_tier(database, settled_tier()).await?);
    Ok(rows)
}

async fn read_tier(
    database: &DatabaseConnection,
    tier: Condition,
) -> Result<Vec<session::Model>, TerminalReconciliationError> {
    Ok(session::Entity::find().filter(tier).all(database).await?)
}
