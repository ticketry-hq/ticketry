//! Compare-and-set and reachability invariants shared by every workflow write.
//!
//! These helpers never become caller-visible: a restricted workflow mutation
//! claims the revision, checks that referenced states belong to the issue
//! type's project, and prunes policy the change made unreachable.

use std::collections::{HashMap, HashSet, VecDeque};

use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, ExprTrait, QueryFilter,
};

use super::super::CommandError;
use ticketry_entities::{issue_type, issue_type_transition, launch_binding, state};

/// A revision-guarded reference to one state of one issue type's workflow.
#[derive(Debug, Clone)]
pub struct RevisionedState {
    pub issue_type_id: String,
    pub state_id: String,
    pub workflow_revision: i32,
}

/// Advance the issue type's workflow revision, or refuse the whole write.
pub(super) async fn claim_workflow_revision(
    transaction: &DatabaseTransaction,
    type_id: &str,
    expected: i32,
) -> Result<issue_type::Model, CommandError> {
    let changed = issue_type::Entity::update_many()
        .col_expr(
            issue_type::Column::WorkflowRevision,
            Expr::col(issue_type::Column::WorkflowRevision).add(1),
        )
        .col_expr(issue_type::Column::UpdatedAt, Expr::current_timestamp())
        .filter(issue_type::Column::Id.eq(type_id))
        .filter(issue_type::Column::WorkflowRevision.eq(expected))
        .exec(transaction)
        .await?;
    if changed.rows_affected == 0 {
        if issue_type::Entity::find_by_id(type_id)
            .one(transaction)
            .await?
            .is_none()
        {
            return Err(CommandError::NotFound(
                "Work-item type not found.".to_owned(),
            ));
        }
        return Err(CommandError::StaleRevision(
            "Workflow revision is stale; read the current workflow and retry.".to_owned(),
        ));
    }
    issue_type::Entity::find_by_id(type_id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work-item type not found.".to_owned()))
}

pub(super) async fn require_project_state(
    transaction: &DatabaseTransaction,
    project_id: &str,
    state_id: &str,
    label: &str,
) -> Result<state::Model, CommandError> {
    state::Entity::find_by_id(state_id)
        .filter(state::Column::ProjectId.eq(project_id))
        .one(transaction)
        .await?
        .ok_or_else(|| {
            CommandError::validation(format!("{label} does not belong to this project."))
        })
}

/// Delete the transitions and launch bindings no longer reachable from start.
pub(super) async fn prune_unreachable(
    transaction: &DatabaseTransaction,
    kind: &issue_type::Model,
    start_state_id: Option<&str>,
) -> Result<(), CommandError> {
    let edges = issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&kind.id))
        .all(transaction)
        .await?;
    let reachable = reachable(start_state_id, &edges);
    let removed = edges
        .iter()
        .filter(|edge| {
            !reachable.contains(&edge.from_state_id) || !reachable.contains(&edge.to_state_id)
        })
        .map(|edge| edge.id)
        .collect::<Vec<_>>();
    if !removed.is_empty() {
        issue_type_transition::Entity::delete_many()
            .filter(issue_type_transition::Column::Id.is_in(removed))
            .exec(transaction)
            .await?;
    }
    launch_binding::Entity::delete_many()
        .filter(launch_binding::Column::IssueTypeId.eq(&kind.id))
        .filter(
            launch_binding::Column::StateId.is_not_in(reachable.into_iter().collect::<Vec<_>>()),
        )
        .exec(transaction)
        .await?;
    Ok(())
}

fn reachable(start: Option<&str>, edges: &[issue_type_transition::Model]) -> HashSet<String> {
    let Some(start) = start else {
        return HashSet::new();
    };
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edges {
        outgoing
            .entry(&edge.from_state_id)
            .or_default()
            .push(&edge.to_state_id);
    }
    let mut result = HashSet::from([start.to_owned()]);
    let mut queue = VecDeque::from([start.to_owned()]);
    while let Some(current) = queue.pop_front() {
        for target in outgoing.get(current.as_str()).into_iter().flatten() {
            if result.insert((*target).to_owned()) {
                queue.push_back((*target).to_owned());
            }
        }
    }
    result
}
