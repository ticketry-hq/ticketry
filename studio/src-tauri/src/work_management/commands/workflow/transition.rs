use std::collections::HashSet;

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::super::fractional_rank;
use super::super::identifiers::database_uuid;
use super::super::status_facts::{
    record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemFact, WorkItemIdentity,
};
use super::super::CommandError;
use crate::work_management::entities::{
    issue, issue_type, issue_type_transition, launch_binding, project, state,
};
use crate::work_management::transition_occurrences::{self, NewTransitionOccurrence};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionOrigin {
    Human,
    Agent,
}

#[derive(Debug, Clone)]
pub struct TransitionWorkItem {
    pub id: String,
    pub target_state_id: String,
    pub origin: TransitionOrigin,
}

#[derive(Debug, Clone)]
pub struct TransitionExpectation {
    pub source_state_id: String,
    pub work_item_revision: i64,
    pub workflow_revision: i32,
    pub request_identity: String,
    pub causation: TransitionCausation,
}

#[derive(Debug, Clone)]
pub enum TransitionCausation {
    RunNow { launch_policy_decision_id: String },
}

pub async fn transition(
    database: &DatabaseConnection,
    input: TransitionWorkItem,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    transition_with_expectation(database, input, None, facts).await
}

pub async fn transition_with_expectation(
    database: &DatabaseConnection,
    input: TransitionWorkItem,
    expectation: Option<TransitionExpectation>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let id = database_uuid(&input.id, "id")?;
    let target_id = database_uuid(&input.target_state_id, "target_state_id")?;
    crate::diagnostics::record_story_move(
        "info",
        "backend-transition-started",
        serde_json::json!({
            "id": id,
            "target_state_id": target_id,
            "origin": format!("{:?}", input.origin).to_lowercase(),
            "guarded": expectation.is_some(),
        }),
    );
    let initial = issue::Entity::find_by_id(&id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let transaction = database.begin().await?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(project::Column::Id.eq(&initial.project_id))
        .exec(&transaction)
        .await?;
    let current = issue::Entity::find_by_id(&id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let kind = issue_type::Entity::find_by_id(&current.issue_type_id)
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work-item type not found.".to_owned()))?;
    crate::diagnostics::record_story_move(
        "info",
        "backend-transition-candidate-loaded",
        serde_json::json!({
            "id": current.id,
            "project_id": current.project_id,
            "issue_type_id": current.issue_type_id,
            "source_state_id": current.state_id,
            "target_state_id": target_id,
            "rank": current.rank,
            "state_revision": current.state_revision,
            "workflow_revision": kind.workflow_revision,
        }),
    );
    if let Some(expected) = &expectation {
        let source_id = database_uuid(&expected.source_state_id, "source_state_id")?;
        if current.state_id.as_deref() != Some(source_id.as_str())
            || current.state_revision != expected.work_item_revision
            || kind.workflow_revision != expected.workflow_revision
        {
            return Err(CommandError::StaleRevision(
                "The Work Item or its workflow changed after preflight.".to_owned(),
            ));
        }
        if expected.request_identity.trim().is_empty() {
            return Err(CommandError::validation(
                "A guarded transition requires a request identity.",
            ));
        }
        match &expected.causation {
            TransitionCausation::RunNow {
                launch_policy_decision_id,
            } if launch_policy_decision_id.trim().is_empty() => {
                return Err(CommandError::validation(
                    "Run Now causation requires a launch policy decision.",
                ));
            }
            TransitionCausation::RunNow { .. } => {}
        }
    }
    let from = match &current.state_id {
        Some(state_id) => {
            state::Entity::find_by_id(state_id)
                .one(&transaction)
                .await?
        }
        None => None,
    };
    let target = state::Entity::find_by_id(&target_id)
        .filter(state::Column::ProjectId.eq(&current.project_id))
        .one(&transaction)
        .await?
        .ok_or_else(|| {
            invalid_transition(
                "No such state in this project.",
                "unknown_state",
                from.as_ref(),
                None,
            )
        })?;
    if current.state_id.as_deref() == Some(target.id.as_str()) {
        return Ok(id);
    }
    if kind.start_state_id.is_none() || from.is_none() {
        return Err(invalid_transition(
            "Published workflows require an explicit graph edge.",
            "illegal_transition",
            from.as_ref(),
            Some(&target),
        ));
    }
    let edges = issue_type_transition::Entity::find()
        .filter(issue_type_transition::Column::IssueTypeId.eq(&kind.id))
        .all(&transaction)
        .await?;
    let nodes = edges
        .iter()
        .flat_map(|edge| [&edge.from_state_id, &edge.to_state_id])
        .chain(kind.start_state_id.iter())
        .collect::<HashSet<_>>();
    if !nodes.contains(&target.id) {
        let other_types = issue_type::Entity::find()
            .filter(issue_type::Column::ProjectId.eq(&current.project_id))
            .filter(issue_type::Column::Id.ne(&kind.id))
            .all(&transaction)
            .await?;
        let other_ids = other_types
            .iter()
            .map(|row| row.id.clone())
            .collect::<Vec<_>>();
        let used_elsewhere = other_types
            .iter()
            .any(|row| row.start_state_id.as_deref() == Some(&target.id))
            || (!other_ids.is_empty()
                && issue_type_transition::Entity::find()
                    .filter(issue_type_transition::Column::IssueTypeId.is_in(other_ids))
                    .filter(
                        sea_orm::sea_query::Condition::any()
                            .add(issue_type_transition::Column::FromStateId.eq(&target.id))
                            .add(issue_type_transition::Column::ToStateId.eq(&target.id)),
                    )
                    .one(&transaction)
                    .await?
                    .is_some());
        return Err(invalid_transition(
            "The target is not a state in the published workflow.",
            if used_elsewhere {
                "foreign_state"
            } else {
                "unknown_state"
            },
            from.as_ref(),
            Some(&target),
        ));
    }
    let edge = edges.iter().find(|edge| {
        current.state_id.as_ref() == Some(&edge.from_state_id) && edge.to_state_id == target.id
    });
    let Some(edge) = edge else {
        return Err(invalid_transition(
            "The published workflow does not allow this state change.",
            "illegal_transition",
            from.as_ref(),
            Some(&target),
        ));
    };
    if input.origin == TransitionOrigin::Agent && !edge.agent_allowed {
        return Err(invalid_transition(
            "This workflow edge is human-only; agents are not allowed to take it.",
            "human_only_transition",
            from.as_ref(),
            Some(&target),
        ));
    }

    let rank = if current.r#type == "task" {
        transition_rank(&transaction, &current, &target.id).await?
    } else {
        current.rank.clone()
    };
    crate::diagnostics::record_story_move(
        "info",
        "backend-transition-rank-computed",
        serde_json::json!({
            "id": current.id,
            "source_state_id": current.state_id,
            "target_state_id": target.id,
            "old_rank": current.rank,
            "new_rank": rank,
        }),
    );
    let revision = next_project_revision(&transaction, &current.project_id).await?;
    let old_cancelled = from
        .as_ref()
        .is_some_and(|state| state.group == "cancelled");
    let new_cancelled = target.group == "cancelled";
    let now = super::super::timestamp::now();
    let occurred_at = stamp(now);
    let mut identity = WorkItemIdentity::of(&current);
    identity.state_id = Some(target.id.clone());
    identity.is_archived = new_cancelled;
    let mut active: issue::ActiveModel = current.clone().into();
    active.state_id = Set(Some(target.id.clone()));
    active.rank = Set(rank.clone());
    active.state_revision = Set(revision);
    active.is_archived = Set(new_cancelled);
    active.updated_at = Set(now.clone());
    active.update(&transaction).await?;
    let mut cascaded: Vec<String> = Vec::new();
    if !old_cancelled && new_cancelled {
        cascaded = archive_descendants(&transaction, &id).await?;
    }
    record_work_item(
        facts,
        &transaction,
        identity.fact(WorkItemChange::Transitioned, revision, &occurred_at),
    )
    .await?;
    for descendant in &cascaded {
        record_work_item(
            facts,
            &transaction,
            WorkItemFact {
                project_id: &current.project_id,
                work_item_id: descendant,
                change: WorkItemChange::Archived,
                revision,
                occurred_at: &occurred_at,
                parent_id: None,
                module_id: None,
                state_id: None,
                is_archived: true,
            },
        )
        .await?;
    }
    let destination_auto_start = launch_binding::Entity::find()
        .filter(launch_binding::Column::IssueTypeId.eq(&kind.id))
        .filter(launch_binding::Column::StateId.eq(&target.id))
        .one(&transaction)
        .await?
        .is_some_and(|binding| binding.auto_start);
    let run_now_decision_id =
        expectation
            .as_ref()
            .and_then(|expectation| match &expectation.causation {
                TransitionCausation::RunNow {
                    launch_policy_decision_id,
                } => Some(launch_policy_decision_id.as_str()),
            });
    transition_occurrences::append(
        &transaction,
        NewTransitionOccurrence {
            issue_id: &id,
            project_id: &current.project_id,
            issue_type_id: &kind.id,
            from_state_id: current
                .state_id
                .as_deref()
                .expect("published transition has a source state"),
            to_state_id: &target.id,
            from_group: &from
                .as_ref()
                .expect("published transition has a source state")
                .group,
            to_group: &target.group,
            work_item_revision: revision,
            workflow_revision: kind.workflow_revision,
            destination_auto_start,
            run_now_decision_id,
        },
    )
    .await?;
    transaction.commit().await?;
    crate::diagnostics::record_story_move(
        "info",
        "backend-transition-committed",
        serde_json::json!({
            "id": id,
            "target_state_id": target.id,
            "rank": rank,
            "state_revision": revision,
            "archived_descendant_count": cascaded.len(),
        }),
    );
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

async fn transition_rank(
    transaction: &DatabaseTransaction,
    current: &issue::Model,
    target_id: &str,
) -> Result<String, CommandError> {
    let tail = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&current.project_id))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::StateId.eq(target_id))
        .filter(issue::Column::IsArchived.eq(false))
        .filter(issue::Column::Id.ne(&current.id))
        .order_by_desc(issue::Column::Rank)
        .order_by_desc(issue::Column::SequenceId)
        .one(transaction)
        .await?;
    let Some(tail) = tail else {
        return Ok(current.rank.clone());
    };
    let successor = issue::Entity::find()
        .filter(issue::Column::ProjectId.eq(&current.project_id))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .filter(issue::Column::Id.ne(&current.id))
        .filter(issue::Column::Rank.gt(&tail.rank))
        .order_by_asc(issue::Column::Rank)
        .order_by_asc(issue::Column::SequenceId)
        .one(transaction)
        .await?;
    fractional_rank::between(
        Some(&tail.rank),
        successor.as_ref().map(|row| row.rank.as_str()),
    )
    .map_err(|_| CommandError::validation("An existing work-item rank is invalid."))
}

async fn next_project_revision(
    transaction: &DatabaseTransaction,
    project_id: &str,
) -> Result<i64, CommandError> {
    super::super::work_items::next_revision(transaction, project_id).await
}

/// Archive the whole subtree, returning every item that left its collections.
async fn archive_descendants(
    transaction: &DatabaseTransaction,
    parent_id: &str,
) -> Result<Vec<String>, CommandError> {
    let mut archived = Vec::new();
    let mut frontier = vec![parent_id.to_owned()];
    while !frontier.is_empty() {
        let children = issue::Entity::find()
            .filter(issue::Column::ParentId.is_in(frontier))
            .all(transaction)
            .await?;
        frontier = children.iter().map(|row| row.id.clone()).collect();
        if !frontier.is_empty() {
            issue::Entity::update_many()
                .col_expr(
                    issue::Column::IsArchived,
                    sea_orm::sea_query::Expr::value(true),
                )
                .filter(issue::Column::Id.is_in(frontier.clone()))
                .exec(transaction)
                .await?;
            archived.extend(frontier.iter().cloned());
        }
    }
    Ok(archived)
}

fn invalid_transition(
    message: impl Into<String>,
    code: &'static str,
    from: Option<&state::Model>,
    to: Option<&state::Model>,
) -> CommandError {
    CommandError::InvalidTransition {
        message: message.into(),
        code,
        from_state: from.map(|state| state.name.clone()),
        to_state: to.map(|state| state.name.clone()),
    }
}
