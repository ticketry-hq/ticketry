use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

use super::{fractional_rank, CommandError};
use ticketry_entities::issue;

/// Allocate a rank before the first active ranked task in the destination state.
pub(super) async fn for_work_item<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
    state_id: Option<&str>,
) -> Result<String, CommandError> {
    let mut first = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(project_id))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .filter(issue::Column::Rank.ne(""));
    first = match state_id {
        Some(state_id) => first.filter(issue::Column::StateId.eq(state_id)),
        None => first.filter(issue::Column::StateId.is_null()),
    };
    let first = first
        .order_by_asc(issue::Column::Rank)
        .order_by_desc(issue::Column::SequenceId)
        .one(database)
        .await?;
    fractional_rank::between(None, first.as_ref().map(|row| row.rank.as_str()))
        .map_err(|_| CommandError::validation("An existing work-item rank is invalid."))
}
