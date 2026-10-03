use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::{json, Map, Value};
use ticketry_entities::sprint;
use ticketry_work_management::{
    commands::CommandError, goals_for_sprint, record_for_run, RecordSprintSuggestion,
    SprintStorySuggestion,
};

use super::{dispatch::DispatchOutput, scope, workflow_tools::string, RunPrincipal};

async fn scoped_sprint(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<sprint::Model, CommandError> {
    let id = string(arguments, "sprint_id")?;
    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| CommandError::field("sprint_id", "Enter a sprint UUID."))?
        .simple()
        .to_string();
    let row = sprint::Entity::find_by_id(id)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Sprint not found.".into()))?;
    scope::project(database, principal, &row.project_id).await?;
    if row.project_id != principal.project_id.replace('-', "") {
        return Err(CommandError::ForeignScope(
            "The caller is not authorized for that sprint.".into(),
        ));
    }
    Ok(row)
}

pub(super) async fn get_sprint_goals(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let sprint = scoped_sprint(database, principal, arguments).await?;
    let goals = goals_for_sprint(database, &principal.project_id, &sprint.id).await?;
    Ok(DispatchOutput::direct(json!({
        "sprint_id": sprint.id,
        "name": sprint.name,
        "status": sprint.status,
        "goals": goals.iter().enumerate().map(|(index, goal)| json!({
            "id": goal.id, "number": format!("G{}", index + 1), "text": goal.text,
        })).collect::<Vec<_>>(),
    })))
}

pub(super) async fn suggest_sprint_story(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let sprint = scoped_sprint(database, principal, arguments).await?;
    let issue_id = nullable_string(arguments, "issue_id")?;
    let name = nullable_string(arguments, "proposed_name")?;
    let epic = nullable_string(arguments, "proposed_epic_id")?;
    let story = match (issue_id, name, epic) {
        (Some(issue_id), None, None) => SprintStorySuggestion::Existing {
            issue_id: issue_id.to_owned(),
        },
        (None, Some(name), Some(epic_id)) => SprintStorySuggestion::Proposal {
            name: name.to_owned(),
            epic_id: Some(epic_id.to_owned()),
        },
        _ => {
            return Err(CommandError::validation(
                "Supply either issue_id alone or both proposed_name and proposed_epic_id.",
            ))
        }
    };
    let suggestion = record_for_run(
        database,
        &principal.project_id,
        &principal.agent_run_id,
        RecordSprintSuggestion {
            sprint_id: sprint.id,
            goal_id: string(arguments, "goal_id")?.to_owned(),
            story,
            reason: string(arguments, "reason")?.to_owned(),
        },
    )
    .await?;
    Ok(DispatchOutput::direct(json!({
        "id": suggestion.id, "sprint_id": suggestion.sprint_id,
        "goal_id": suggestion.goal_id, "issue_id": suggestion.issue_id,
        "proposed_name": suggestion.proposed_name,
        "proposed_epic_id": suggestion.proposed_epic_id,
        "reason": suggestion.reason, "status": suggestion.status,
    })))
}

fn nullable_string<'a>(
    arguments: &'a Map<String, Value>,
    field: &'static str,
) -> Result<Option<&'a str>, CommandError> {
    match arguments.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value)),
        _ => Err(CommandError::field(field, "Expected a string or null.")),
    }
}
