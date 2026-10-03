use super::*;
use sea_orm::EntityTrait;
use seaography::async_graphql::{Request, Variables};
use serde_json::{json, Value};
use ticketry_entities::{issue, project, sprint_suggestion, status_event};
use ticketry_work_management::{record_for_run, RecordSprintSuggestion, SprintStorySuggestion};

pub const UPDATE: &str = "mutation($id: String!, $status: String!, $name: String) {
    update_sprint_suggestion(id: $id, status: $status, proposed_name: $name) {
        id status issueId proposedName issue { id sprintId name parentId stateRevision }
    }
}";

pub fn input(story: SprintStorySuggestion) -> RecordSprintSuggestion {
    RecordSprintSuggestion {
        sprint_id: SPRINT.into(),
        goal_id: GOAL.into(),
        story,
        reason: "Fits G1".into(),
    }
}
pub fn proposal() -> SprintStorySuggestion {
    SprintStorySuggestion::Proposal {
        name: "Proposed".into(),
        epic_id: Some(EPIC.into()),
    }
}
pub async fn record(f: &Fixture, story: SprintStorySuggestion) -> sprint_suggestion::Model {
    record_for_run(&f.db, PROJECT, RUN, input(story))
        .await
        .unwrap()
}
pub async fn update(f: &Fixture, id: &str, status: &str, name: Option<&str>) -> Value {
    let mut vars = json!({"id": id, "status": status});
    if let Some(name) = name {
        vars["name"] = json!(name);
    }
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(vars)))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()["update_sprint_suggestion"].clone()
}
pub async fn snapshot(
    f: &Fixture,
) -> (
    Vec<issue::Model>,
    Vec<project::Model>,
    Vec<status_event::Model>,
    Vec<sprint_suggestion::Model>,
) {
    (
        issue::Entity::find().all(&f.db).await.unwrap(),
        project::Entity::find().all(&f.db).await.unwrap(),
        status_event::Entity::find().all(&f.db).await.unwrap(),
        sprint_suggestion::Entity::find().all(&f.db).await.unwrap(),
    )
}
