//! The start-state member of the restricted IssueType update.
//!
//! Start state is a column on the issue type, so it is patched by
//! `catalog::update_issue_type` rather than by a bespoke action. It runs inside
//! that update's transaction because claiming the workflow revision rewrites
//! the row the rest of the patch is derived from.

use sea_orm::{ActiveModelTrait, DatabaseTransaction, Set};

use super::super::identifiers::database_uuid;
use super::super::CommandError;
use super::revision_guard::{claim_workflow_revision, prune_unreachable, require_project_state};
use crate::work_management::entities::issue_type;

/// Move the workflow's start state, then prune what it no longer reaches.
pub async fn apply_start_state(
    transaction: &DatabaseTransaction,
    issue_type_id: &str,
    state_id: &str,
    workflow_revision: i32,
) -> Result<(), CommandError> {
    let type_id = database_uuid(issue_type_id, "issue_type_id")?;
    let state_id = database_uuid(state_id, "start_state_id")?;
    let kind = claim_workflow_revision(transaction, &type_id, workflow_revision).await?;
    require_project_state(transaction, &kind.project_id, &state_id, "Start state").await?;
    let mut active: issue_type::ActiveModel = kind.clone().into();
    active.start_state_id = Set(Some(state_id.clone()));
    active.updated_at = Set(super::super::timestamp::now());
    active.update(transaction).await?;
    prune_unreachable(transaction, &kind, Some(&state_id)).await?;
    Ok(())
}
