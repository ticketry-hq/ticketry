use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, IntoActiveModel, PaginatorTrait, QueryFilter, TransactionTrait,
};

use super::identifiers::database_uuid;
use super::status_facts::{
    record_workflow_state, stamp, WorkFactRecorder, WorkflowStateChange, WorkflowStateFact,
};
use super::CommandError;
use crate::entities::work_management::{
    issue, issue_type, issue_type_transition, launch_binding, project, state,
};

/// Delete one empty, unreferenced catalogue state under the Django guards.
pub async fn delete_state(
    database: &DatabaseConnection,
    state_id: &str,
) -> Result<(), CommandError> {
    let transaction = database.begin().await?;
    let (_, active) = prepare_state_delete(&transaction, state_id, None).await?;
    active.delete(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

/// Prepare one guarded State deletion inside the caller's transaction.
pub(crate) async fn prepare_state_delete(
    transaction: &DatabaseTransaction,
    state_id: &str,
    facts: Option<&WorkFactRecorder>,
) -> Result<(state::Model, state::ActiveModel), CommandError> {
    let state_id = database_uuid(state_id, "state_id")?;
    let initial = state::Entity::find_by_id(&state_id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("State not found.".to_owned()))?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&initial.project_id))
        .exec(transaction)
        .await?;
    let current = state::Entity::find_by_id(&state_id)
        .one(transaction)
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
        .count(transaction)
        .await?;
    if siblings == 0 {
        return Err(CommandError::Conflict(format!(
            "State '{}' is the last state in its group and cannot be deleted.",
            current.name
        )));
    }
    let occupied = issue::Entity::find()
        .filter(issue::Column::StateId.eq(&state_id))
        .count(transaction)
        .await?;
    if occupied != 0 {
        return Err(CommandError::Conflict(format!(
            "State '{}' is occupied by {occupied} work item(s) and cannot be deleted.",
            current.name
        )));
    }
    let referenced = issue_type::Entity::find()
        .filter(issue_type::Column::StartStateId.eq(&state_id))
        .one(transaction)
        .await?
        .is_some()
        || issue_type_transition::Entity::find()
            .filter(
                sea_orm::sea_query::Condition::any()
                    .add(issue_type_transition::Column::FromStateId.eq(&state_id))
                    .add(issue_type_transition::Column::ToStateId.eq(&state_id)),
            )
            .one(transaction)
            .await?
            .is_some()
        || launch_binding::Entity::find()
            .filter(launch_binding::Column::StateId.eq(&state_id))
            .one(transaction)
            .await?
            .is_some();
    if referenced {
        return Err(CommandError::Conflict(format!(
            "State '{}' is referenced by workflow configuration and cannot be deleted.",
            current.name
        )));
    }
    let occurred_at = stamp(super::timestamp::now());
    record_workflow_state(
        facts,
        transaction,
        WorkflowStateFact {
            project_id: &current.project_id,
            state_id: &current.id,
            change: WorkflowStateChange::Deleted,
            name: &current.name,
            group: &current.group,
            color: &current.color,
            sort_order: current.sort_order,
            occurred_at: &occurred_at,
        },
    )
    .await?;
    let active = current.clone().into_active_model();
    Ok((current, active))
}
