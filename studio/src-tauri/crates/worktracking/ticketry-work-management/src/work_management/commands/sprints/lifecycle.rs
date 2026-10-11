//! Atomic Sprint lifecycle validation and unfinished-work carryover.

use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set};
use ticketry_entities::{issue, sprint, state};

use super::super::{
    status_facts::{record_work_item, stamp, WorkFactRecorder, WorkItemChange, WorkItemIdentity},
    timestamp,
    work_items::next_revision,
    CommandError,
};
use super::open_sprint;

pub(super) async fn start(
    transaction: &DatabaseTransaction,
    current: &sprint::Model,
) -> Result<(), CommandError> {
    if let Some(running) = sprint::Entity::find()
        .filter(sprint::Column::ProjectId.eq(&current.project_id))
        .filter(sprint::Column::Status.eq(ticketry_entities::SPRINT_ACTIVE))
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

pub(super) async fn complete(
    transaction: &DatabaseTransaction,
    current: &sprint::Model,
    carryover_sprint_id: Option<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<(), CommandError> {
    let target = match carryover_sprint_id {
        Some(target_id) => {
            let target = open_sprint(transaction, &target_id, &current.project_id).await?;
            if target.id == current.id || target.status != ticketry_entities::SPRINT_PLANNED {
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
            identity.fact(WorkItemChange::SprintChanged, revision, &occurred_at),
        )
        .await?;
    }
    Ok(())
}
