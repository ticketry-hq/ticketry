use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, IntoActiveModel, QueryFilter,
    Set,
};
use ticketry_entities::{issue, issue_type, sprint, sprint_suggestion};

mod recording;
pub(crate) use recording::record_in;
mod validation;
pub use recording::{
    goals_for_sprint, record_for_run, RecordSprintSuggestion, SprintStorySuggestion,
};
use validation::{validate_epic, validate_name, validate_story};

use super::{
    identifiers::database_uuid,
    sprints::{assign_work_item_sprint, open_sprint},
    status_facts::WorkFactRecorder,
    work_items::{self, CreateWorkItem},
    workflow::PatchValue,
    CommandError,
};

/// Take the writer lock before reading the suggestion or its run fence.
async fn lock_sprint(txn: &DatabaseTransaction, id: &str) -> Result<sprint::Model, CommandError> {
    sprint::Entity::update_many()
        .col_expr(sprint::Column::Status, Expr::col(sprint::Column::Status))
        .filter(sprint::Column::Id.eq(id))
        .exec(txn)
        .await?;
    let row = sprint::Entity::find_by_id(id)
        .one(txn)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint not found.".into()))?;
    open_sprint(txn, id, &row.project_id).await
}

/// Prepare the suggestion row; the restricted mutation saves it in this transaction.
pub(crate) async fn set_status(
    txn: &DatabaseTransaction,
    id: &str,
    status: &str,
    proposed_name: PatchValue<String>,
    facts: Option<&WorkFactRecorder>,
) -> Result<sprint_suggestion::ActiveModel, CommandError> {
    let id = database_uuid(id, "id")?;
    // A guarded write locks before the first read, including concurrent duplicate accepts.
    sprint_suggestion::Entity::update_many()
        .col_expr(
            sprint_suggestion::Column::Status,
            Expr::col(sprint_suggestion::Column::Status),
        )
        .filter(sprint_suggestion::Column::Id.eq(&id))
        .exec(txn)
        .await?;
    let current = sprint_suggestion::Entity::find_by_id(id)
        .one(txn)
        .await?
        .ok_or_else(|| CommandError::NotFound("Suggestion not found.".into()))?;
    let sprint = lock_sprint(txn, &current.sprint_id).await?;
    let mut active = current.clone().into_active_model();
    match proposed_name {
        PatchValue::Unset => {}
        PatchValue::Null => {
            return Err(CommandError::field(
                "proposed_name",
                "A proposal name cannot be null.",
            ))
        }
        PatchValue::Value(name) => {
            let name = name.trim().to_owned();
            validate_name(&name)?;
            let same_accept = current.status == ticketry_entities::SPRINT_SUGGESTION_ACCEPTED
                && status == ticketry_entities::SPRINT_SUGGESTION_ACCEPTED
                && current.proposed_name.as_deref() == Some(name.as_str());
            if !same_accept
                && (current.status != ticketry_entities::SPRINT_SUGGESTION_WAITING
                    || current.issue_id.is_some())
            {
                return Err(CommandError::field(
                    "proposed_name",
                    "Only a waiting proposal can be renamed.",
                ));
            }
            if !same_accept {
                active.proposed_name = Set(Some(name));
            }
        }
    }
    match (current.status.as_str(), status) {
        (from, to) if from == to => {}
        (
            ticketry_entities::SPRINT_SUGGESTION_WAITING,
            ticketry_entities::SPRINT_SUGGESTION_ACCEPTED,
        ) => {
            let id = match current.issue_id {
                Some(id) => {
                    validate_story(txn, &sprint.project_id, &id).await?;
                    id
                }
                None => {
                    validate_epic(txn, &sprint.project_id, current.proposed_epic_id.as_deref())
                        .await?;
                    let kind = issue_type::Entity::find()
                        .filter(issue_type::Column::ProjectId.eq(&sprint.project_id))
                        .filter(issue_type::Column::Level.eq("task"))
                        .filter(issue_type::Column::Name.eq("Story"))
                        .one(txn)
                        .await?
                        .ok_or_else(|| {
                            CommandError::validation("The project has no Story issue type.")
                        })?;
                    work_items::create_in(
                        txn,
                        CreateWorkItem {
                            sprint_id: None,
                            project_id: sprint.project_id,
                            issue_type_id: kind.id,
                            name: active
                                .proposed_name
                                .try_as_ref()
                                .and_then(|name| name.clone())
                                .ok_or_else(|| {
                                    CommandError::validation("Proposal name is missing.")
                                })?,
                            parent_id: current.proposed_epic_id,
                            description: None,
                            state_id: None,
                        },
                        facts,
                    )
                    .await?
                }
            };
            assign_work_item_sprint(
                txn,
                &id,
                PatchValue::Value(super::sprint_selector::SprintSelector::Explicit(
                    current.sprint_id,
                )),
                facts,
            )
            .await?;
            active.issue_id = Set(Some(id));
        }
        (
            ticketry_entities::SPRINT_SUGGESTION_ACCEPTED,
            ticketry_entities::SPRINT_SUGGESTION_WAITING,
        ) => {
            let id = current
                .issue_id
                .ok_or_else(|| CommandError::validation("Accepted suggestion has no story."))?;
            let story = issue::Entity::find_by_id(&id)
                .one(txn)
                .await?
                .ok_or_else(|| CommandError::NotFound("Work item not found.".into()))?;
            if story.project_id != sprint.project_id
                || story.sprint_id.as_deref() != Some(current.sprint_id.as_str())
            {
                return Err(CommandError::Conflict(
                    "The story has moved since acceptance.".into(),
                ));
            }
            assign_work_item_sprint(txn, &id, PatchValue::Null, facts).await?;
            active.proposed_name = Set(None);
            active.proposed_epic_id = Set(None);
        }
        (
            ticketry_entities::SPRINT_SUGGESTION_WAITING,
            ticketry_entities::SPRINT_SUGGESTION_DISMISSED,
        )
        | (
            ticketry_entities::SPRINT_SUGGESTION_DISMISSED,
            ticketry_entities::SPRINT_SUGGESTION_WAITING,
        ) => {}
        _ => {
            return Err(CommandError::field(
                "status",
                "Invalid suggestion status transition.",
            ))
        }
    }
    active.status = Set(status.to_owned());
    Ok(active)
}
