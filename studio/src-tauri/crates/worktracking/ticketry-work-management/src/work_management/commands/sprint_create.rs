//! Prepare one Sprint insert under the Project's sequence ownership lock.

use sea_orm::{
    sea_query::Expr, ActiveValue, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set,
};
use ticketry_entities::{project, sprint};

use super::{identifiers::database_uuid, sprint_sequence, CommandError};

pub(crate) async fn prepare(
    transaction: &DatabaseTransaction,
    mut active: sprint::ActiveModel,
) -> Result<sprint::ActiveModel, CommandError> {
    let project_id = match &active.project_id {
        ActiveValue::Set(value) | ActiveValue::Unchanged(value) => {
            database_uuid(value, "project_id")?
        }
        ActiveValue::NotSet => {
            return Err(CommandError::field("project_id", "This field is required."));
        }
    };
    let locked = project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&project_id))
        .exec(transaction)
        .await?;
    if locked.rows_affected == 0 {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let sequence = sprint_sequence::ordered(transaction, &project_id).await?;
    active.project_id = Set(project_id);
    active.rank = Set(sprint_sequence::append_rank(&sequence)?);
    Ok(active)
}
