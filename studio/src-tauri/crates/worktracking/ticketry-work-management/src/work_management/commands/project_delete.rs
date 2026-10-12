//! Project aggregate teardown in one transaction.
//!
//! The installed schema keeps Django's deferred, non-cascading foreign keys
//! from Work Items and catalogue rows to their Project. Every owned row is
//! removed before the Project row so the commit-time checks see no dangling
//! reference, and any failure rolls the whole aggregate back.

use super::identifiers::database_uuid;
use super::CommandError;
use crate::work_management::database::begin_write;
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect};
use ticketry_entities::{
    issue, issue_blocker, issue_type, issue_type_transition, launch_binding, project, state,
};

pub async fn delete_project(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<(), CommandError> {
    let id = database_uuid(project_id, "project_id")?;
    let transaction = begin_write(database).await?;
    if project::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .is_none()
    {
        return Err(CommandError::NotFound("Project not found.".to_owned()));
    }
    let work_items = issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .filter(issue::Column::ProjectId.eq(&id))
        .into_tuple::<String>()
        .all(&transaction)
        .await?;
    let issue_types = issue_type::Entity::find()
        .select_only()
        .column(issue_type::Column::Id)
        .filter(issue_type::Column::ProjectId.eq(&id))
        .into_tuple::<String>()
        .all(&transaction)
        .await?;
    // Work Items first: they select issue types and states, and their
    // blocker edges reference them.
    issue_blocker::Entity::delete_many()
        .filter(
            Condition::any()
                .add(issue_blocker::Column::FromIssueId.is_in(work_items.clone()))
                .add(issue_blocker::Column::ToIssueId.is_in(work_items)),
        )
        .exec(&transaction)
        .await?;
    issue::Entity::delete_many()
        .filter(issue::Column::ProjectId.eq(&id))
        .exec(&transaction)
        .await?;
    // Workflow policy references both issue types and states.
    issue_type_transition::Entity::delete_many()
        .filter(issue_type_transition::Column::IssueTypeId.is_in(issue_types.clone()))
        .exec(&transaction)
        .await?;
    launch_binding::Entity::delete_many()
        .filter(launch_binding::Column::IssueTypeId.is_in(issue_types))
        .exec(&transaction)
        .await?;
    // Issue types name a start state, so they go before the states.
    issue_type::Entity::delete_many()
        .filter(issue_type::Column::ProjectId.eq(&id))
        .exec(&transaction)
        .await?;
    state::Entity::delete_many()
        .filter(state::Column::ProjectId.eq(&id))
        .exec(&transaction)
        .await?;
    project::Entity::delete_by_id(id).exec(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}
