//! Sprint lifecycle and project-scoped Work Item membership writes.

use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DatabaseTransaction, EntityTrait, IntoActiveModel, QueryFilter, QuerySelect, QueryTrait, Set,
    TransactionTrait,
};

use super::{
    identifiers::database_uuid,
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity},
    timestamp,
    work_items::next_revision,
    workflow::PatchValue,
    CommandError,
};
use ticketry_entities::{agent_run, issue, project, sprint, sprint_suggestion, state};

pub(crate) async fn plan_work_item(
    database: &DatabaseConnection,
    id: &str,
    sprint_id: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let transaction = database.begin().await?;
    let id = assign_work_item_sprint(&transaction, id, sprint_id, facts).await?;
    transaction.commit().await?;
    if let Some(facts) = facts {
        facts.wake();
    }
    Ok(id)
}

/// Assign inside the caller's transaction so proposal creation and assignment
/// commit together. The caller wakes fact subscribers after committing.
pub(crate) async fn assign_work_item_sprint(
    transaction: &DatabaseTransaction,
    id: &str,
    sprint_id: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<String, CommandError> {
    let id = database_uuid(id, "id")?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(
            project::Column::Id.in_subquery(
                issue::Entity::find()
                    .select_only()
                    .column(issue::Column::ProjectId)
                    .filter(issue::Column::Id.eq(&id))
                    .into_query(),
            ),
        )
        .exec(transaction)
        .await?;
    let current = issue::Entity::find_by_id(&id)
        .one(transaction)
        .await?
        .filter(|row| row.r#type == "task")
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    let target = match sprint_id {
        PatchValue::Value(sprint_id) => Some(
            open_sprint(transaction, &sprint_id, &current.project_id)
                .await?
                .id,
        ),
        PatchValue::Null => None,
        PatchValue::Unset => {
            return Err(CommandError::field("sprint_id", "Submit a sprint or null."))
        }
    };
    if current.sprint_id == target {
        return Ok(id);
    }
    let revision = next_revision(transaction, &current.project_id).await?;
    let identity = WorkItemIdentity::of(&current);
    let now = timestamp::now();
    let occurred_at = stamp(now);
    let mut active: issue::ActiveModel = current.into();
    active.sprint_id = Set(target);
    active.state_revision = Set(revision);
    active.updated_at = Set(now);
    active.update(transaction).await?;
    record_work_item(
        facts,
        transaction,
        identity.fact(WorkItemChange::Updated, revision, &occurred_at),
    )
    .await?;
    Ok(id)
}

pub(crate) struct UpdateSprint {
    pub id: String,
    pub name: PatchValue<String>,
    pub status: PatchValue<String>,
    pub carryover_sprint_id: PatchValue<String>,
    pub suggestion_run_id: PatchValue<String>,
}

pub(crate) async fn prepare_sprint_update(
    transaction: &DatabaseTransaction,
    input: UpdateSprint,
    facts: Option<&WorkFactRecorder>,
) -> Result<sprint::ActiveModel, CommandError> {
    let id = database_uuid(&input.id, "id")?;
    project::Entity::update_many()
        .col_expr(
            project::Column::StateRevision,
            Expr::col(project::Column::StateRevision),
        )
        .filter(
            project::Column::Id.in_subquery(
                sprint::Entity::find()
                    .select_only()
                    .column(sprint::Column::ProjectId)
                    .filter(sprint::Column::Id.eq(&id))
                    .into_query(),
            ),
        )
        .exec(transaction)
        .await?;
    let current = sprint::Entity::find_by_id(&id)
        .one(transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint not found.".to_owned()))?;
    let name = non_nullable_patch(input.name, "name")?;
    let status = non_nullable_patch(input.status, "status")?;
    if current.status == sprint::COMPLETED {
        return Err(CommandError::validation(
            "A completed sprint is closed and cannot change.",
        ));
    }
    if !input.carryover_sprint_id.is_unset() && status.as_deref() != Some(sprint::COMPLETED) {
        return Err(CommandError::field(
            "carryover_sprint_id",
            "Carry-over applies only when completing a sprint.",
        ));
    }
    let mut active = current.clone().into_active_model();
    if let Some(name) = name {
        active.name = Set(name);
    }
    if let Some(run_id) =
        validated_suggestion_run(transaction, input.suggestion_run_id, &current.project_id).await?
    {
        if let Some(previous) = &current.suggestion_run_id {
            ticketry_runs::restrict_sprint_suggestion_run_in(transaction, previous).await?;
        }
        if let Some(next) = &run_id {
            if current.suggestion_run_id.as_ref() != Some(next) {
                ticketry_runs::restrict_sprint_suggestion_run_in(transaction, next).await?;
            }
        }
        if current.suggestion_run_id != run_id {
            sprint_suggestion::Entity::delete_many()
                .filter(sprint_suggestion::Column::SprintId.eq(&current.id))
                .filter(sprint_suggestion::Column::Status.eq(sprint_suggestion::WAITING))
                .exec(transaction)
                .await?;
            active.suggestion_run_id = Set(run_id);
        }
    }
    if let Some(status) = status.filter(|status| *status != current.status) {
        match (current.status.as_str(), status.as_str()) {
            (sprint::PLANNED, sprint::ACTIVE) => start(transaction, &current).await?,
            (sprint::ACTIVE, sprint::COMPLETED) => {
                let carryover = match input.carryover_sprint_id {
                    PatchValue::Value(id) => Some(id),
                    PatchValue::Null | PatchValue::Unset => None,
                };
                complete(transaction, &current, carryover, facts).await?;
            }
            (from, to) => {
                return Err(CommandError::field(
                    "status",
                    format!("A sprint cannot move from {from} to {to}."),
                ))
            }
        }
        active.status = Set(status);
    }
    active.updated_at = Set(timestamp::now());
    Ok(active)
}

async fn validated_suggestion_run(
    transaction: &DatabaseTransaction,
    patch: PatchValue<String>,
    project_id: &str,
) -> Result<Option<Option<String>>, CommandError> {
    match patch {
        PatchValue::Unset => Ok(None),
        PatchValue::Null => Ok(Some(None)),
        PatchValue::Value(run_id) => {
            // Agent run IDs are opaque persisted identifiers, not database UUIDs.
            let run = agent_run::Entity::find_by_id(&run_id)
                .find_also_related(issue::Entity)
                .one(transaction)
                .await?;
            let Some((_, Some(work_item))) = run else {
                return Err(CommandError::field(
                    "suggestion_run_id",
                    "Agent run not found.",
                ));
            };
            if work_item.project_id != project_id {
                return Err(CommandError::field(
                    "suggestion_run_id",
                    "The agent run belongs to another project.",
                ));
            }
            Ok(Some(Some(run_id)))
        }
    }
}

async fn start(
    transaction: &DatabaseTransaction,
    current: &sprint::Model,
) -> Result<(), CommandError> {
    if let Some(running) = sprint::Entity::find()
        .filter(sprint::Column::ProjectId.eq(&current.project_id))
        .filter(sprint::Column::Status.eq(sprint::ACTIVE))
        .one(transaction)
        .await?
    {
        return Err(CommandError::Conflict(format!(
            "'{}' is already active; complete it first.",
            running.name
        )));
    }
    Ok(())
}

async fn complete(
    transaction: &DatabaseTransaction,
    current: &sprint::Model,
    carryover_sprint_id: Option<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let target = match carryover_sprint_id {
        Some(target_id) => {
            let target = open_sprint(transaction, &target_id, &current.project_id).await?;
            if target.id == current.id || target.status != sprint::PLANNED {
                return Err(CommandError::field(
                    "carryover_sprint_id",
                    "Carry unfinished work into a planned sprint.",
                ));
            }
            Some(target.id)
        }
        None => None,
    };
    let finished_states = state::Entity::find()
        .filter(state::Column::ProjectId.eq(&current.project_id))
        .filter(state::Column::Group.is_in(["completed", "cancelled"]))
        .all(transaction)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
    let unfinished = issue::Entity::find()
        .filter(issue::Column::SprintId.eq(&current.id))
        .filter(issue::Column::Type.eq("task"))
        .filter(
            sea_orm::Condition::any()
                .add(issue::Column::StateId.is_null())
                .add(issue::Column::StateId.is_not_in(finished_states)),
        )
        .all(transaction)
        .await?;
    if unfinished.is_empty() {
        return Ok(());
    }
    let revision = next_revision(transaction, &current.project_id).await?;
    let now = timestamp::now();
    let occurred_at = stamp(now);
    for work_item in unfinished {
        let identity = WorkItemIdentity::of(&work_item);
        let mut active: issue::ActiveModel = work_item.into();
        active.sprint_id = Set(target.clone());
        active.state_revision = Set(revision);
        active.updated_at = Set(now);
        active.update(transaction).await?;
        record_work_item(
            facts,
            transaction,
            identity.fact(WorkItemChange::Updated, revision, &occurred_at),
        )
        .await?;
    }
    Ok(())
}

pub(crate) async fn open_sprint<C: ConnectionTrait>(
    database: &C,
    sprint_id: &str,
    project_id: &str,
) -> Result<sprint::Model, CommandError> {
    let sprint_id = database_uuid(sprint_id, "sprint_id")?;
    let sprint = sprint::Entity::find_by_id(&sprint_id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint not found.".to_owned()))?;
    if sprint.project_id != project_id {
        return Err(CommandError::field(
            "sprint_id",
            "The sprint belongs to another project.",
        ));
    }
    if sprint.status == sprint::COMPLETED {
        return Err(CommandError::field(
            "sprint_id",
            "A completed sprint is closed to new work.",
        ));
    }
    Ok(sprint)
}

fn non_nullable_patch(
    patch: PatchValue<String>,
    field: &'static str,
) -> Result<Option<String>, CommandError> {
    match patch {
        PatchValue::Unset => Ok(None),
        PatchValue::Value(value) => Ok(Some(value)),
        PatchValue::Null => Err(CommandError::field(field, "This field may not be null.")),
    }
}
