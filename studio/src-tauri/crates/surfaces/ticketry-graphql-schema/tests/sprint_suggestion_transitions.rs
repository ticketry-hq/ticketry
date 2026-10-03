mod sprint_planning_support;
use sprint_planning_support::*;

use sea_orm::{ConnectionTrait, DbBackend, EntityTrait, Statement};
use seaography::async_graphql::{Request, Variables};
use serde_json::{json, Value};
use ticketry_entities::{issue, project, sprint_suggestion, status_event};
use ticketry_work_management::{
    goals_for_sprint, record_for_run, RecordSprintSuggestion, SprintStorySuggestion,
};

const UPDATE: &str = "mutation($id: String!, $status: String!, $name: String) {
    update_sprint_suggestion(id: $id, status: $status, proposed_name: $name) {
        id status issueId proposedName issue { id sprintId name parentId stateRevision }
    }
}";

fn input(story: SprintStorySuggestion) -> RecordSprintSuggestion {
    RecordSprintSuggestion {
        sprint_id: SPRINT.into(),
        goal_id: GOAL.into(),
        story,
        reason: "Fits G1".into(),
    }
}
fn proposal() -> SprintStorySuggestion {
    SprintStorySuggestion::Proposal {
        name: "Proposed".into(),
        epic_id: Some(EPIC.into()),
    }
}
async fn record(f: &Fixture, story: SprintStorySuggestion) -> sprint_suggestion::Model {
    record_for_run(&f.db, PROJECT, RUN, input(story))
        .await
        .unwrap()
}
async fn update(f: &Fixture, id: &str, status: &str, name: Option<&str>) -> Value {
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
async fn snapshot(
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

#[tokio::test]
async fn accept_existing_returns_assigned_issue_and_undo_restores_backlog() {
    let f = fixture().await;
    let row = record(
        &f,
        SprintStorySuggestion::Existing {
            issue_id: STORY.into(),
        },
    )
    .await;
    let accepted = update(&f, &row.id, "accepted", None).await;
    assert_eq!(accepted["issue"]["id"], STORY);
    assert_eq!(accepted["issue"]["sprintId"], SPRINT);
    assert_eq!(accepted["issue"]["stateRevision"], 2);
    let before = snapshot(&f).await;
    update(&f, &row.id, "accepted", None).await;
    assert_eq!(
        snapshot(&f).await,
        before,
        "duplicate accept must not change a work item"
    );
    let undone = update(&f, &row.id, "waiting", None).await;
    assert_eq!(undone["status"], "waiting");
    assert_eq!(undone["issue"]["sprintId"], Value::Null);
    assert_eq!(undone["issue"]["stateRevision"], 3);
    assert_eq!(
        status_event::Entity::find().all(&f.db).await.unwrap().len(),
        2
    );
}

#[tokio::test]
async fn proposal_accept_rename_and_undo_preserve_one_created_story() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let accepted = update(&f, &row.id, "accepted", Some("  Edited  ")).await;
    assert_eq!(accepted["proposedName"], "Edited");
    assert_eq!(accepted["issue"]["name"], "Edited");
    assert_eq!(accepted["issue"]["parentId"], EPIC);
    assert_eq!(accepted["issue"]["sprintId"], SPRINT);
    let undone = update(&f, &row.id, "waiting", None).await;
    assert_eq!(undone["issueId"], accepted["issueId"]);
    assert_eq!(undone["issue"]["sprintId"], Value::Null);
    assert_eq!(undone["proposedName"], Value::Null);
    let reaccepted = update(&f, &row.id, "accepted", None).await;
    assert_eq!(reaccepted["issueId"], accepted["issueId"]);
    assert_eq!(issue::Entity::find().all(&f.db).await.unwrap().len(), 3);
    let events = status_event::Entity::find().all(&f.db).await.unwrap();
    assert_eq!(
        events.len(),
        4,
        "create, assign, undo, reassign each record a fact"
    );
}

#[tokio::test]
async fn dismiss_and_undo_change_only_the_suggestion() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let before = snapshot(&f).await;
    assert_eq!(
        update(&f, &row.id, "dismissed", None).await["status"],
        "dismissed"
    );
    let after = snapshot(&f).await;
    assert_eq!(
        (&after.0, &after.1, &after.2),
        (&before.0, &before.1, &before.2)
    );
    update(&f, &row.id, "waiting", None).await;
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn failed_accept_rolls_back_creation_assignment_counters_and_facts() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let before = snapshot(&f).await;
    f.db.execute_unprepared(
        "CREATE TRIGGER fail_accept BEFORE UPDATE ON worktracker_sprint_suggestion
        WHEN NEW.status = 'accepted' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    )
    .await
    .unwrap();
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(
            json!({"id": row.id, "status": "accepted"}),
        )))
        .await;
    assert!(
        response
            .errors
            .iter()
            .any(|error| error.message.contains("injected failure")),
        "{:?}",
        response.errors
    );
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn completed_sprint_rejects_accept_without_any_partial_writes() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    f.db.execute_unprepared("UPDATE worktracker_sprint SET status = 'completed'")
        .await
        .unwrap();
    let before = snapshot(&f).await;
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(
            json!({"id": row.id, "status": "accepted"}),
        )))
        .await;
    assert!(!response.errors.is_empty());
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn agent_recording_is_current_run_scoped_and_never_assigns_or_prunes() {
    let f = fixture().await;
    assert_eq!(
        goals_for_sprint(&f.db, PROJECT, SPRINT)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        goals_for_sprint(&f.db, "20000000-0000-0000-0000-000000000002", SPRINT)
            .await
            .is_err()
    );
    let dismissed = record(&f, proposal()).await;
    update(&f, &dismissed.id, "dismissed", None).await;
    let before = snapshot(&f).await;
    let error = record_for_run(&f.db, PROJECT, "old-run", input(proposal()))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "run_not_current");
    assert!(record_for_run(
        &f.db,
        "20000000-0000-0000-0000-000000000002",
        RUN,
        input(proposal())
    )
    .await
    .is_err());
    assert_eq!(snapshot(&f).await, before);
    record(
        &f,
        SprintStorySuggestion::Existing {
            issue_id: STORY.into(),
        },
    )
    .await;
    let after = snapshot(&f).await;
    assert_eq!(
        (&after.0, &after.1, &after.2),
        (&before.0, &before.1, &before.2)
    );
    assert_eq!(after.3.len(), 2);
    assert_eq!(
        after.3.iter().find(|r| r.id == dismissed.id).unwrap(),
        &before.3[0]
    );
    f.db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE worktracker_issue SET sprint_id = ? WHERE id = ?",
        [
            "10000000000000000000000000000001".into(),
            "50000000000000000000000000000001".into(),
        ],
    ))
    .await
    .unwrap();
    assert!(record_for_run(
        &f.db,
        PROJECT,
        RUN,
        input(SprintStorySuggestion::Existing {
            issue_id: STORY.into()
        })
    )
    .await
    .is_err());
}

#[tokio::test]
async fn suggestion_schema_exposes_one_restricted_model_write() {
    let f = fixture().await;
    let response = f
        .schema
        .execute("{ __schema { mutationType { fields { name args { name } } } } }")
        .await;
    let data = response.data.into_json().unwrap();
    let fields: Vec<_> = data["__schema"]["mutationType"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|field| {
            field["name"]
                .as_str()
                .unwrap()
                .to_lowercase()
                .contains("suggestion")
        })
        .collect();
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0]["name"], "update_sprint_suggestion");
    assert_eq!(
        fields[0]["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|arg| arg["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["id", "status", "proposed_name"]
    );
}

#[tokio::test]
async fn rejected_status_and_name_writes_leave_every_row_unchanged() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let before = snapshot(&f).await;
    for vars in [
        json!({"id": row.id, "status": "unknown"}),
        json!({"id": row.id, "status": "accepted", "name": "  "}),
    ] {
        let response = f
            .schema
            .execute(Request::new(UPDATE).variables(Variables::from_json(vars)))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(snapshot(&f).await, before);
    }
    update(&f, &row.id, "waiting", Some("Draft edited")).await;
    update(&f, &row.id, "dismissed", None).await;
    let before = snapshot(&f).await;
    for vars in [
        json!({"id": row.id, "status": "accepted"}),
        json!({"id": row.id, "status": "waiting", "name": "Changed"}),
    ] {
        let response = f
            .schema
            .execute(Request::new(UPDATE).variables(Variables::from_json(vars)))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(snapshot(&f).await, before);
    }
}

#[tokio::test]
async fn accept_rejects_a_foreign_story_and_undo_does_not_unassign_a_moved_story() {
    let f = fixture().await;
    let row = record(
        &f,
        SprintStorySuggestion::Existing {
            issue_id: STORY.into(),
        },
    )
    .await;
    f.db.execute_unprepared("UPDATE worktracker_issue SET project_id = '20000000000000000000000000000002' WHERE type = 'task'").await.unwrap();
    let before = snapshot(&f).await;
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(
            json!({"id": row.id, "status": "accepted"}),
        )))
        .await;
    assert!(!response.errors.is_empty());
    assert_eq!(snapshot(&f).await, before);
    f.db.execute_unprepared("UPDATE worktracker_issue SET project_id = '20000000000000000000000000000001' WHERE type = 'task'").await.unwrap();
    update(&f, &row.id, "accepted", None).await;
    f.db.execute_unprepared("UPDATE worktracker_issue SET sprint_id = NULL WHERE type = 'task'")
        .await
        .unwrap();
    let before = snapshot(&f).await;
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(
            json!({"id": row.id, "status": "waiting"}),
        )))
        .await;
    assert_eq!(
        response.errors[0]
            .extensions
            .as_ref()
            .unwrap()
            .get("code")
            .unwrap()
            .to_string(),
        "\"conflict\""
    );
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn simultaneous_proposal_accepts_create_one_story() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let (first, second) = tokio::join!(
        update(&f, &row.id, "accepted", None),
        update(&f, &row.id, "accepted", None)
    );
    assert_eq!(first["issueId"], second["issueId"]);
    assert_eq!(issue::Entity::find().all(&f.db).await.unwrap().len(), 3);
    assert_eq!(
        status_event::Entity::find().all(&f.db).await.unwrap().len(),
        2
    );
}
