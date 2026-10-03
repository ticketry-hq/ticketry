use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseTransaction, EntityTrait, IntoActiveModel, QueryFilter,
    Set,
};
use ticketry_entities::{issue, issue_type, sprint, sprint_suggestion};

mod recording;
pub use recording::{
    goals_for_sprint, record_for_run, RecordSprintSuggestion, SprintStorySuggestion,
};

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
            if current.status != sprint_suggestion::WAITING || current.issue_id.is_some() {
                return Err(CommandError::field(
                    "proposed_name",
                    "Only a waiting proposal can be renamed.",
                ));
            }
            let name = name.trim().to_owned();
            validate_name(&name)?;
            active.proposed_name = Set(Some(name));
        }
    }
    match (current.status.as_str(), status) {
        (from, to) if from == to => {}
        (sprint_suggestion::WAITING, sprint_suggestion::ACCEPTED) => {
            let id = match current.issue_id {
                Some(id) => id,
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
            assign_work_item_sprint(txn, &id, PatchValue::Value(current.sprint_id), facts).await?;
            active.issue_id = Set(Some(id));
        }
        (sprint_suggestion::ACCEPTED, sprint_suggestion::WAITING) => {
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
        (sprint_suggestion::WAITING, sprint_suggestion::DISMISSED)
        | (sprint_suggestion::DISMISSED, sprint_suggestion::WAITING) => {}
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

fn validate_name(name: &str) -> Result<(), CommandError> {
    if name.trim().is_empty() || name.trim().chars().count() > 512 {
        return Err(CommandError::field(
            "proposed_name",
            "Enter a name of 1 to 512 characters.",
        ));
    }
    Ok(())
}

async fn validate_epic(
    txn: &DatabaseTransaction,
    project_id: &str,
    id: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(id) = id {
        let epic = issue::Entity::find_by_id(id).one(txn).await?.filter(|row| {
            row.project_id == project_id && row.r#type == "module" && !row.is_archived
        });
        if epic.is_none() {
            return Err(CommandError::field(
                "proposed_epic_id",
                "Choose a live epic in this project.",
            ));
        }
    }
    Ok(())
}
