use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use super::super::CommandError;
use ticketry_entities::issue;

/// Run Now is unavailable for a Story with any direct child, whatever the
/// child's state or archive flag. Callers check once before preflight and again
/// inside the guarded transition, after the project writer lock that child
/// creation and reparenting also take, so a late child cannot slip through.
pub async fn refuse_run_now_with_subtasks<C: ConnectionTrait>(
    database: &C,
    work_item_id: &str,
) -> Result<(), CommandError> {
    let child = issue::Entity::find()
        .filter(issue::Column::ParentId.eq(work_item_id))
        .one(database)
        .await?;
    match child {
        Some(_) => Err(CommandError::Rejected {
            message: "The Story has subtasks; Run Now is unavailable.".to_owned(),
            code: "story_has_subtasks",
            field: None,
        }),
        None => Ok(()),
    }
}
