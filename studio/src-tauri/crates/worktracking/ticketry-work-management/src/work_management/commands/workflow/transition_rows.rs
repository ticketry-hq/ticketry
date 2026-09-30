//! Create, update, and delete one persisted workflow transition row.
//!
//! A transition is ordinary CRUD (ADR 0005). Its identity is the natural key
//! `(issue_type_id, from_state_id, to_state_id)`; `workflow_revision` is the
//! compare-and-set guard. `agent_allowed` and `handoff` are writable policy.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, Set, TransactionTrait,
};

use super::super::identifiers::database_uuid;
use super::super::CommandError;
use super::revision_guard::{claim_workflow_revision, prune_unreachable, require_project_state};
use ticketry_entities::issue_type_transition;

#[derive(Debug, Clone)]
pub struct NewTransition {
    pub issue_type_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub agent_allowed: bool,
    pub handoff: bool,
    pub workflow_revision: i32,
}

#[derive(Debug, Clone)]
pub struct TransitionPatch {
    pub issue_type_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub agent_allowed: Option<bool>,
    pub handoff: Option<bool>,
    pub workflow_revision: i32,
}

#[derive(Debug, Clone)]
pub struct RevisionedTransition {
    pub issue_type_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub workflow_revision: i32,
}

pub async fn create_transition(
    database: &DatabaseConnection,
    input: NewTransition,
) -> Result<i64, CommandError> {
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let from_id = database_uuid(&input.from_state_id, "from_state_id")?;
    let to_id = database_uuid(&input.to_state_id, "to_state_id")?;
    if from_id == to_id {
        return Err(CommandError::validation(
            "A workflow transition must change state.",
        ));
    }
    let transaction = database.begin().await?;
    let kind = claim_workflow_revision(&transaction, &type_id, input.workflow_revision).await?;
    require_project_state(&transaction, &kind.project_id, &from_id, "From state").await?;
    require_project_state(&transaction, &kind.project_id, &to_id, "To state").await?;
    if issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&type_id))
        .filter(issue_type_transition::Column::FromStateId.eq(&from_id))
        .filter(issue_type_transition::Column::ToStateId.eq(&to_id))
        .one(&transaction)
        .await?
        .is_some()
    {
        return Err(CommandError::Conflict(
            "That workflow transition already exists.".to_owned(),
        ));
    }
    let row = issue_type_transition::ActiveModel {
        id: sea_orm::ActiveValue::NotSet,
        issue_type_id: Set(type_id),
        from_state_id: Set(from_id),
        to_state_id: Set(to_id),
        agent_allowed: Set(input.agent_allowed),
        handoff: Set(input.handoff),
    }
    .insert(&transaction)
    .await?;
    transaction.commit().await?;
    Ok(row.id)
}

pub async fn update_transition(
    database: &DatabaseConnection,
    input: TransitionPatch,
) -> Result<i64, CommandError> {
    if input.agent_allowed.is_none() && input.handoff.is_none() {
        return Err(CommandError::validation(
            "A workflow transition update must change policy.",
        ));
    }
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let from_id = database_uuid(&input.from_state_id, "from_state_id")?;
    let to_id = database_uuid(&input.to_state_id, "to_state_id")?;
    let transaction = database.begin().await?;
    let kind = claim_workflow_revision(&transaction, &type_id, input.workflow_revision).await?;
    require_project_state(&transaction, &kind.project_id, &from_id, "From state").await?;
    require_project_state(&transaction, &kind.project_id, &to_id, "To state").await?;
    let row = transition_row(&transaction, &type_id, &from_id, &to_id).await?;
    let id = row.id;
    let mut active: issue_type_transition::ActiveModel = row.into();
    if let Some(agent_allowed) = input.agent_allowed {
        active.agent_allowed = Set(agent_allowed);
    }
    if let Some(handoff) = input.handoff {
        active.handoff = Set(handoff);
    }
    active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(id)
}

pub async fn delete_transition(
    database: &DatabaseConnection,
    input: RevisionedTransition,
) -> Result<(), CommandError> {
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let from_id = database_uuid(&input.from_state_id, "from_state_id")?;
    let to_id = database_uuid(&input.to_state_id, "to_state_id")?;
    let transaction = database.begin().await?;
    let kind = claim_workflow_revision(&transaction, &type_id, input.workflow_revision).await?;
    require_project_state(&transaction, &kind.project_id, &from_id, "From state").await?;
    require_project_state(&transaction, &kind.project_id, &to_id, "To state").await?;
    let row = transition_row(&transaction, &type_id, &from_id, &to_id).await?;
    issue_type_transition::Entity::delete_by_id(row.id)
        .exec(&transaction)
        .await?;
    prune_unreachable(&transaction, &kind, kind.start_state_id.as_deref()).await?;
    transaction.commit().await?;
    Ok(())
}

async fn transition_row(
    transaction: &DatabaseTransaction,
    type_id: &str,
    from_id: &str,
    to_id: &str,
) -> Result<issue_type_transition::Model, CommandError> {
    issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(type_id))
        .filter(issue_type_transition::Column::FromStateId.eq(from_id))
        .filter(issue_type_transition::Column::ToStateId.eq(to_id))
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Workflow transition not found.".to_owned()))
}
