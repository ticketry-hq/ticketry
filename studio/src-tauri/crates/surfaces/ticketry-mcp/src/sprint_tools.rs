//! Reading an open sprint's goals and recording one sprint-story suggestion
//! for the current sprint suggestion run. Both tools are run-only: a sprint
//! belongs to the run's own project, which a global connection has none of.

use rmcp::schemars::JsonSchema;
use sea_orm::{DatabaseConnection, EntityTrait};
use serde::Deserialize;
use serde_json::{json, Value};
use ticketry_entities::sprint;
use ticketry_work_management::{
    commands::CommandError, goals_for_sprint, record_for_run, RecordSprintSuggestion,
    SprintStorySuggestion,
};

use super::{
    scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
    RunPrincipal,
};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(
            TypedTool::new(
                "get_sprint_goals",
                "Read the goals with G-numbers for an open sprint in your project.",
                get_sprint_goals,
            )
            .run_only(),
        )
        .with(
            TypedTool::new(
                "suggest_sprint_story",
                "Record a suggestion for the current sprint suggestion run. Supply issue_id alone, or proposed_name and proposed_epic_id. This never assigns a story to a sprint.",
                suggest_sprint_story,
            )
            .run_only(),
        )
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(deny_unknown_fields)]
struct SprintReference {
    sprint_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
#[serde(deny_unknown_fields)]
struct StorySuggestion {
    sprint_id: String,
    goal_id: String,
    #[serde(default)]
    issue_id: Option<String>,
    #[serde(default)]
    proposed_name: Option<String>,
    #[serde(default)]
    proposed_epic_id: Option<String>,
    reason: String,
}

async fn scoped_sprint(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    sprint_id: &str,
) -> Result<sprint::Model, CommandError> {
    let id = uuid::Uuid::parse_str(sprint_id)
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

async fn get_sprint_goals(
    call: ToolCall,
    SprintReference { sprint_id }: SprintReference,
) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    let sprint = scoped_sprint(database, principal, &sprint_id).await?;
    let goals = goals_for_sprint(database, &principal.project_id, &sprint.id).await?;
    Ok(json!({
        "sprint_id": sprint.id,
        "name": sprint.name,
        "status": sprint.status,
        "goals": goals.iter().enumerate().map(|(index, goal)| json!({
            "id": goal.id, "number": format!("G{}", index + 1), "text": goal.text,
        })).collect::<Vec<_>>(),
    }))
}

async fn suggest_sprint_story(
    call: ToolCall,
    request: StorySuggestion,
) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    let sprint = scoped_sprint(database, principal, &request.sprint_id).await?;
    let story = match (
        request.issue_id,
        request.proposed_name,
        request.proposed_epic_id,
    ) {
        (Some(issue_id), None, None) => SprintStorySuggestion::Existing { issue_id },
        (None, Some(name), Some(epic_id)) => SprintStorySuggestion::Proposal {
            name,
            epic_id: Some(epic_id),
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
            goal_id: request.goal_id,
            story,
            reason: request.reason,
        },
    )
    .await?;
    Ok(json!({
        "id": suggestion.id, "sprint_id": suggestion.sprint_id,
        "goal_id": suggestion.goal_id, "issue_id": suggestion.issue_id,
        "proposed_name": suggestion.proposed_name,
        "proposed_epic_id": suggestion.proposed_epic_id,
        "reason": suggestion.reason, "status": suggestion.status,
    }))
}
