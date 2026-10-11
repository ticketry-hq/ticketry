//! Project-owned Sprint sequence allocation, always inside its writer's lock.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, Set,
};
use ticketry_entities::sprint;

use super::{fractional_rank, CommandError};

pub(super) async fn ordered(
    transaction: &DatabaseTransaction,
    project_id: &str,
) -> Result<Vec<sprint::Model>, CommandError> {
    let mut rows = sprint::Entity::find()
        .filter(sprint::Column::ProjectId.eq(project_id))
        .order_by_asc(sprint::Column::Rank)
        .order_by_asc(sprint::Column::Id)
        .all(transaction)
        .await?;
    if rows.windows(2).any(|pair| pair[0].rank == pair[1].rank) {
        // Rank ties across the history boundary can put a planned Sprint
        // first by ID. Preserve order within each lifecycle partition while
        // restoring completed -> active -> planned before spacing ranks.
        rows.sort_by(|left, right| {
            phase(&left.status)
                .cmp(&phase(&right.status))
                .then_with(|| left.rank.cmp(&right.rank))
                .then_with(|| left.id.cmp(&right.id))
        });
        let ranks = fractional_rank::rebalance(rows.len());
        for (row, rank) in rows.iter_mut().zip(ranks) {
            if row.rank != rank {
                let mut active = row.clone().into_active_model();
                active.rank = Set(rank);
                *row = active.update(transaction).await?;
            }
        }
    }
    Ok(rows)
}

fn phase(status: &str) -> u8 {
    match status {
        ticketry_entities::SPRINT_COMPLETED => 0,
        ticketry_entities::SPRINT_ACTIVE => 1,
        _ => 2,
    }
}

pub(super) fn append_rank(rows: &[sprint::Model]) -> Result<String, CommandError> {
    fractional_rank::between(rows.last().map(|row| row.rank.as_str()), None)
        .map_err(|_| CommandError::validation("An existing sprint rank is invalid."))
}

/// A started Sprint becomes the next historical entry. Keep an existing
/// boundary rank so starting the first planned Sprint never rewrites order.
pub(super) fn rank_for_start(
    rows: &[sprint::Model],
    current: &sprint::Model,
) -> Result<Option<String>, CommandError> {
    let history_count = rows
        .iter()
        .filter(|row| row.status != ticketry_entities::SPRINT_PLANNED)
        .count();
    if rows
        .get(history_count)
        .is_some_and(|row| row.id == current.id)
    {
        return Ok(None);
    }
    let before = rows
        .iter()
        .rev()
        .find(|row| row.status != ticketry_entities::SPRINT_PLANNED);
    let after = rows
        .iter()
        .find(|row| row.status == ticketry_entities::SPRINT_PLANNED && row.id != current.id);
    fractional_rank::between(
        before.map(|row| row.rank.as_str()),
        after.map(|row| row.rank.as_str()),
    )
    .map(Some)
    .map_err(|_| CommandError::validation("The sprint history boundary has invalid ranks."))
}
