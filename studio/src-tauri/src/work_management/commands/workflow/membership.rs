//! Removing a state from a workflow — the one declared workflow exception.
//!
//! Workflow membership is reachability, not a row: dropping a member deletes
//! every transition that touches it and then prunes whatever the remaining
//! graph no longer reaches. That cannot be expressed as CRUD on one row, so it
//! stays a named domain operation in the route/operation registry.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};

use super::super::identifiers::database_uuid;
use super::super::CommandError;
use super::revision_guard::{
    claim_workflow_revision, prune_unreachable, require_project_state, RevisionedState,
};
use crate::work_management::entities::issue_type_transition;

pub async fn remove_state(
    database: &DatabaseConnection,
    input: RevisionedState,
) -> Result<(), CommandError> {
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let state_id = database_uuid(&input.state_id, "state_id")?;
    let transaction = database.begin().await?;
    let kind = claim_workflow_revision(&transaction, &type_id, input.workflow_revision).await?;
    require_project_state(&transaction, &kind.project_id, &state_id, "State").await?;
    if kind.start_state_id.as_deref() == Some(&state_id) {
        return Err(CommandError::validation(
            "The workflow start state cannot be removed; change the start state instead.",
        ));
    }
    issue_type_transition::Entity::delete_many()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&type_id))
        .filter(
            sea_orm::sea_query::Condition::any()
                .add(issue_type_transition::Column::FromStateId.eq(&state_id))
                .add(issue_type_transition::Column::ToStateId.eq(&state_id)),
        )
        .exec(&transaction)
        .await?;
    prune_unreachable(&transaction, &kind, kind.start_state_id.as_deref()).await?;
    transaction.commit().await?;
    Ok(())
}
