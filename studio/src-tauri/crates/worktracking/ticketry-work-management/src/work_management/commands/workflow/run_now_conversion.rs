//! Run Now converts the Story it starts into the project's Implementation task.
//!
//! The destination type comes from project configuration and is pinned by its
//! workflow revision at preflight. The guarded transition commits the type
//! change only against the workflow the launch policy was resolved from, so a
//! reconfigured Implementation workflow rolls the whole move back.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use super::super::CommandError;
use ticketry_entities::{issue_type, issue_type_transition};

const DESTINATION_TYPE: &str = "Implementation";

/// The project's Implementation type, when its workflow includes `state_id`.
pub async fn run_now_destination_type<C: ConnectionTrait>(
    database: &C,
    project_id: &str,
    state_id: &str,
) -> Result<Option<issue_type::Model>, CommandError> {
    let Some(kind) = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(project_id))
        .filter(issue_type::Column::Name.eq(DESTINATION_TYPE))
        .filter(issue_type::Column::Level.eq("task"))
        .one(database)
        .await?
    else {
        return Ok(None);
    };
    Ok(workflow_includes(database, &kind, state_id)
        .await?
        .then_some(kind))
}

/// Revalidate the preflight destination type inside the guarded transition.
pub(super) async fn claim_destination_type<C: ConnectionTrait>(
    transaction: &C,
    project_id: &str,
    issue_type_id: &str,
    workflow_revision: i32,
    target_state_id: &str,
) -> Result<String, CommandError> {
    let kind = issue_type::Entity::find_by_id(issue_type_id.replace('-', ""))
        .filter(issue_type::Column::ProjectId.eq(project_id))
        .filter(issue_type::Column::Name.eq(DESTINATION_TYPE))
        .filter(issue_type::Column::Level.eq("task"))
        .one(transaction)
        .await?;
    match kind {
        Some(kind)
            if kind.workflow_revision == workflow_revision
                && workflow_includes(transaction, &kind, target_state_id).await? =>
        {
            Ok(kind.id)
        }
        _ => Err(CommandError::StaleRevision(
            "The Implementation workflow changed after preflight.".to_owned(),
        )),
    }
}

async fn workflow_includes<C: ConnectionTrait>(
    database: &C,
    kind: &issue_type::Model,
    state_id: &str,
) -> Result<bool, CommandError> {
    if kind.start_state_id.as_deref() == Some(state_id) {
        return Ok(true);
    }
    Ok(issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&kind.id))
        .filter(
            sea_orm::sea_query::Condition::any()
                .add(issue_type_transition::Column::FromStateId.eq(state_id))
                .add(issue_type_transition::Column::ToStateId.eq(state_id)),
        )
        .one(database)
        .await?
        .is_some())
}
