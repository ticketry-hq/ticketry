mod sprint_planning_support;

use sea_orm::{ConnectionTrait, EntityTrait};
use seaography::async_graphql::{Request, Variables};
use serde_json::{json, Value};
use sprint_planning_support::*;
use ticketry_entities::{sprint, sprint_goal};
use ticketry_work_management::{
    goals_for_sprint, record_for_run, RecordSprintSuggestion, SprintStorySuggestion,
};

const CREATE: &str = "mutation($sprint: String!, $text: String!) {
    create_sprint_goal(sprint_id: $sprint, text: $text) { id sprintId text position }
}";
const UPDATE: &str = "mutation($id: String!, $text: String!) {
    update_sprint_goal(id: $id, text: $text) { id sprintId text position }
}";
const DELETE: &str = "mutation($id: String!) { delete_sprint_goal(id: $id) }";

async fn execute(f: &Fixture, query: &str, variables: Value) -> Value {
    let response = f
        .schema
        .execute(Request::new(query).variables(Variables::from_json(variables)))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()
}
async fn create(f: &Fixture, sprint: &str, text: &str) -> Value {
    execute(f, CREATE, json!({"sprint": sprint, "text": text})).await["create_sprint_goal"].clone()
}
async fn snapshot(f: &Fixture) -> (Vec<sprint::Model>, Vec<sprint_goal::Model>) {
    (
        sprint::Entity::find().all(&f.db).await.unwrap(),
        sprint_goal::Entity::find().all(&f.db).await.unwrap(),
    )
}
async fn revision(f: &Fixture) -> Value {
    execute(f, "query($id: String!) { worktrackerSprint(filters: {id: {eq: $id}}) { nodes { goalsRevisedAt } } }",
        json!({"id": SPRINT})).await["worktrackerSprint"]["nodes"][0]["goalsRevisedAt"].clone()
}

#[tokio::test]
async fn goals_append_per_sprint_and_updates_preserve_protected_fields() {
    let f = fixture().await;
    let second = create(&f, SPRINT, "  Second  ").await;
    let third = create(&f, SPRINT, "Third").await;
    assert_eq!(second["position"], 2);
    assert_eq!(second["text"], "Second");
    assert_eq!(third["position"], 3);
    let updated = execute(
        &f,
        UPDATE,
        json!({"id": second["id"], "text": "  Revised  "}),
    )
    .await;
    assert_eq!(
        updated["update_sprint_goal"],
        json!({"id": second["id"], "sprintId": SPRINT, "text": "Revised", "position": 2})
    );
    execute(&f, DELETE, json!({"id": second["id"]})).await;
    assert_eq!(create(&f, SPRINT, "Fourth").await["position"], 4);
    f.db.execute_unprepared("INSERT INTO worktracker_sprint (id, project_id, name, status, created_at, updated_at)
        VALUES ('10000000000000000000000000000002', '20000000000000000000000000000001', 'Other', 'planned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").await.unwrap();
    assert_eq!(
        create(&f, "10000000-0000-0000-0000-000000000002", "Other").await["position"],
        1
    );
}

#[tokio::test]
async fn every_goal_write_advances_revision_and_failed_writes_roll_it_back() {
    let f = fixture().await;
    assert_eq!(revision(&f).await, Value::Null);
    let goal = create(&f, SPRINT, "New goal").await;
    let created = revision(&f).await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    execute(&f, UPDATE, json!({"id": goal["id"], "text": "Revised"})).await;
    let updated = revision(&f).await;
    assert!(updated.as_str().unwrap() > created.as_str().unwrap());
    let before = snapshot(&f).await;
    for (query, vars) in [
        (CREATE, json!({"sprint": SPRINT, "text": " "})),
        (UPDATE, json!({"id": goal["id"], "text": " "})),
        (
            CREATE,
            json!({"sprint": "10000000-0000-0000-0000-00000000dead", "text": "Missing"}),
        ),
        (
            DELETE,
            json!({"id": "30000000-0000-0000-0000-00000000dead"}),
        ),
        ("mutation { delete_sprint_goal }", json!({})),
        ("mutation { delete_sprint_goal(id: null) }", json!({})),
    ] {
        let response = f
            .schema
            .execute(Request::new(query).variables(Variables::from_json(vars)))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(snapshot(&f).await, before);
    }
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    assert_eq!(
        execute(&f, DELETE, json!({"id": goal["id"]})).await["delete_sprint_goal"],
        true
    );
    assert!(revision(&f).await.as_str().unwrap() > updated.as_str().unwrap());
}

#[tokio::test]
async fn completed_sprints_reject_all_three_goal_writes_atomically() {
    let f = fixture().await;
    f.db.execute_unprepared("UPDATE worktracker_sprint SET status = 'completed'")
        .await
        .unwrap();
    let before = snapshot(&f).await;
    for (query, vars) in [
        (CREATE, json!({"sprint": SPRINT, "text": "New"})),
        (UPDATE, json!({"id": GOAL, "text": "Changed"})),
        (DELETE, json!({"id": GOAL})),
    ] {
        let response = f
            .schema
            .execute(Request::new(query).variables(Variables::from_json(vars)))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(snapshot(&f).await, before);
    }
}

#[tokio::test]
async fn concurrent_goal_creates_allocate_distinct_positions() {
    let f = fixture().await;
    let (one, two) = tokio::join!(create(&f, SPRINT, "One"), create(&f, SPRINT, "Two"));
    let mut positions = [
        one["position"].as_i64().unwrap(),
        two["position"].as_i64().unwrap(),
    ];
    positions.sort();
    assert_eq!(positions, [2, 3]);
}

#[tokio::test]
async fn live_goal_crud_integrates_with_record_accept_and_undo() {
    let f = fixture().await;
    let goal = create(&f, SPRINT, "Ship this proposal").await;
    let goal_id = goal["id"].as_str().unwrap();
    let revision_before = revision(&f).await;
    assert_eq!(
        goals_for_sprint(&f.db, PROJECT, SPRINT)
            .await
            .unwrap()
            .len(),
        2
    );
    let suggestion = record_for_run(
        &f.db,
        PROJECT,
        RUN,
        RecordSprintSuggestion {
            sprint_id: SPRINT.into(),
            goal_id: goal_id.into(),
            reason: "Fits the new goal".into(),
            story: SprintStorySuggestion::Proposal {
                name: "Proposed".into(),
                epic_id: Some(EPIC.into()),
            },
        },
    )
    .await
    .unwrap();
    let query = "mutation($id: String!, $status: String!) {
        update_sprint_suggestion(id: $id, status: $status) { status issueId issue { id sprintId } }
    }";
    let accepted = execute(
        &f,
        query,
        json!({"id": suggestion.id, "status": "accepted"}),
    )
    .await;
    assert_eq!(
        accepted["update_sprint_suggestion"]["issue"]["sprintId"],
        SPRINT
    );
    let undone = execute(&f, query, json!({"id": suggestion.id, "status": "waiting"})).await;
    assert_eq!(
        undone["update_sprint_suggestion"]["issueId"],
        accepted["update_sprint_suggestion"]["issueId"]
    );
    assert_eq!(
        undone["update_sprint_suggestion"]["issue"]["sprintId"],
        Value::Null
    );
    assert_eq!(revision(&f).await, revision_before);
    execute(&f, DELETE, json!({"id": goal_id})).await;
    assert!(revision(&f).await.as_str().unwrap() > revision_before.as_str().unwrap());
    assert_eq!(
        goals_for_sprint(&f.db, PROJECT, SPRINT)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn goal_schema_exposes_only_restricted_inputs_without_position() {
    let f = fixture().await;
    let data = execute(&f, "{ __schema { mutationType { fields { name args { name } } } types { kind name inputFields { name } } } }", json!({})).await;
    let fields = data["__schema"]["mutationType"]["fields"]
        .as_array()
        .unwrap();
    let mut goal_names: Vec<_> = fields
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .filter(|name| name.to_lowercase().replace('_', "").contains("sprintgoal"))
        .collect();
    goal_names.sort();
    assert_eq!(
        goal_names,
        [
            "create_sprint_goal",
            "delete_sprint_goal",
            "update_sprint_goal"
        ]
    );
    for (name, expected) in [
        ("create_sprint_goal", vec!["sprint_id", "text"]),
        ("update_sprint_goal", vec!["id", "text"]),
        ("delete_sprint_goal", vec!["id"]),
    ] {
        let field = fields.iter().find(|field| field["name"] == name).unwrap();
        assert_eq!(
            field["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            expected
        );
    }
    for input in data["__schema"]["types"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| {
            t["kind"] == "INPUT_OBJECT"
                && t["name"].as_str().unwrap().contains("SprintGoal")
                && (t["name"].as_str().unwrap().contains("Insert")
                    || t["name"].as_str().unwrap().contains("Update"))
        })
    {
        assert!(!input["inputFields"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field["name"] == "position"));
    }
}
