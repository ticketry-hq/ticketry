use super::{
    database_uuid, lock_sprint, open_sprint, validate_epic, validate_name, validate_story,
    CommandError,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};
use ticketry_entities::{sprint_goal, sprint_suggestion};

#[derive(Debug, Clone)]
pub struct RecordSprintSuggestion {
    pub sprint_id: String,
    pub goal_id: String,
    pub story: SprintStorySuggestion,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub enum SprintStorySuggestion {
    Existing {
        issue_id: String,
    },
    Proposal {
        name: String,
        epic_id: Option<String>,
    },
}

/// The host supplies project and run identity from its authenticated principal.
pub async fn record_for_run(
    database: &DatabaseConnection,
    project_id: &str,
    run_id: &str,
    input: RecordSprintSuggestion,
) -> Result<sprint_suggestion::Model, CommandError> {
    let txn = database.begin().await?;
    let row = record_in(&txn, project_id, run_id, input).await?;
    txn.commit().await?;
    Ok(row)
}

pub(crate) async fn record_in(
    txn: &DatabaseTransaction,
    project_id: &str,
    run_id: &str,
    input: RecordSprintSuggestion,
) -> Result<sprint_suggestion::Model, CommandError> {
    let sprint_id = database_uuid(&input.sprint_id, "sprint_id")?;
    let project_id = database_uuid(project_id, "project_id")?;
    let sprint = lock_sprint(txn, &sprint_id).await?;
    open_sprint(txn, &sprint_id, &project_id).await?;
    if sprint.suggestion_run_id.as_deref() != Some(run_id) {
        return Err(CommandError::Rejected {
            message: "The suggestion run is no longer current.".into(),
            code: "run_not_current",
            field: None,
        });
    }
    let (issue_id, proposed_name, proposed_epic_id) = match input.story {
        SprintStorySuggestion::Existing { issue_id } => {
            (Some(database_uuid(&issue_id, "issue_id")?), None, None)
        }
        SprintStorySuggestion::Proposal { name, epic_id } => {
            validate_name(&name)?;
            let epic_id = epic_id
                .map(|id| database_uuid(&id, "proposed_epic_id"))
                .transpose()?;
            validate_epic(txn, &project_id, epic_id.as_deref()).await?;
            (None, Some(name.trim().to_owned()), epic_id)
        }
    };
    let goal_id = database_uuid(&input.goal_id, "goal_id")?;
    let goal = sprint_goal::Entity::find_by_id(&goal_id).one(txn).await?;
    if !goal.is_some_and(|goal| goal.sprint_id == sprint_id) {
        return Err(CommandError::field(
            "goal_id",
            "Choose a goal in this sprint.",
        ));
    }
    let story = match &issue_id {
        Some(id) => Some(validate_story(txn, &project_id, id).await?),
        None => None,
    };
    let reviewed = sprint_suggestion::Entity::find()
        .filter(sprint_suggestion::Column::SprintId.eq(&sprint_id))
        .filter(
            sprint_suggestion::Column::Status
                .is_in([sprint_suggestion::ACCEPTED, sprint_suggestion::DISMISSED]),
        )
        .order_by_asc(sprint_suggestion::Column::CreatedAt)
        .order_by_asc(sprint_suggestion::Column::Id)
        .all(txn)
        .await?;
    if let Some(previous) =
        reviewed
            .into_iter()
            .find(|previous| match (&issue_id, &proposed_name) {
                (Some(id), _) => previous.issue_id.as_ref() == Some(id),
                (None, Some(name)) => {
                    previous.proposed_epic_id == proposed_epic_id
                        && previous
                            .proposed_name
                            .as_ref()
                            .is_some_and(|old| old.trim().to_lowercase() == name.to_lowercase())
                }
                _ => false,
            })
    {
        return Ok(previous);
    }
    if story.is_some_and(|story| story.sprint_id.as_deref() == Some(sprint_id.as_str())) {
        return Err(CommandError::field(
            "issue_id",
            "The story is already in this sprint.",
        ));
    }
    let row = sprint_suggestion::ActiveModel {
        sprint_id: Set(sprint_id),
        goal_id: Set(goal_id),
        issue_id: Set(issue_id),
        proposed_name: Set(proposed_name),
        proposed_epic_id: Set(proposed_epic_id),
        reason: Set(input.reason),
        run_id: Set(run_id.to_owned()),
        ..Default::default()
    }
    .insert(txn)
    .await?;
    Ok(row)
}

pub async fn goals_for_sprint(
    database: &DatabaseConnection,
    project_id: &str,
    sprint_id: &str,
) -> Result<Vec<sprint_goal::Model>, CommandError> {
    let project_id = database_uuid(project_id, "project_id")?;
    let sprint = open_sprint(database, sprint_id, &project_id).await?;
    Ok(sprint_goal::Entity::find()
        .filter(sprint_goal::Column::SprintId.eq(sprint.id))
        .order_by_asc(sprint_goal::Column::Position)
        .all(database)
        .await?)
}
