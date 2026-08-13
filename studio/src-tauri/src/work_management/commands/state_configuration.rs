use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    TransactionTrait,
};

use super::identifiers::database_uuid;
use super::CommandError;
use crate::work_management::entities::{
    issue, issue_type, issue_type_transition, launch_binding, project, state,
};

/// Delete one empty, unreferenced catalogue state under the Django guards.
pub async fn delete_state(
    database: &DatabaseConnection,
    state_id: &str,
) -> Result<(), CommandError> {
    let state_id = database_uuid(state_id, "state_id")?;
    let initial = state::Entity::find_by_id(&state_id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("State not found.".to_owned()))?;
    let transaction = database.begin().await?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&initial.project_id))
        .exec(&transaction)
        .await?;
    let current = state::Entity::find_by_id(&state_id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("State not found.".to_owned()))?;
    if current.is_protected {
        return Err(CommandError::Conflict(format!(
            "State '{}' is protected and cannot be deleted.",
            current.name
        )));
    }
    let siblings = state::Entity::find()
        .filter(state::Column::ProjectId.eq(&current.project_id))
        .filter(state::Column::Group.eq(&current.group))
        .filter(state::Column::Id.ne(&state_id))
        .count(&transaction)
        .await?;
    if siblings == 0 {
        return Err(CommandError::Conflict(format!(
            "State '{}' is the last state in its group and cannot be deleted.",
            current.name
        )));
    }
    let occupied = issue::Entity::find()
        .filter(issue::Column::StateId.eq(&state_id))
        .count(&transaction)
        .await?;
    if occupied != 0 {
        return Err(CommandError::Conflict(format!(
            "State '{}' is occupied by {occupied} work item(s) and cannot be deleted.",
            current.name
        )));
    }
    let referenced = issue_type::Entity::find()
        .filter(issue_type::Column::StartStateId.eq(&state_id))
        .one(&transaction)
        .await?
        .is_some()
        || issue_type_transition::Entity::find()
            .filter(
                sea_orm::sea_query::Condition::any()
                    .add(issue_type_transition::Column::FromStateId.eq(&state_id))
                    .add(issue_type_transition::Column::ToStateId.eq(&state_id)),
            )
            .one(&transaction)
            .await?
            .is_some()
        || launch_binding::Entity::find()
            .filter(launch_binding::Column::StateId.eq(&state_id))
            .one(&transaction)
            .await?
            .is_some();
    if referenced {
        return Err(CommandError::Conflict(format!(
            "State '{}' is referenced by workflow configuration and cannot be deleted.",
            current.name
        )));
    }
    state::Entity::delete_by_id(state_id)
        .exec(&transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}
