//! Local PostgreSQL API proof, not hosted Supabase or desktop/browser integration.
//! Run against a dedicated disposable local database:
//! TEST_POSTGRES_URL=postgresql://user@127.0.0.1:5432/ticketry_test \
//! cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-planner \
//!   --test postgres_planning postgres_planning_round_trip -- --ignored --nocapture
//!
//! Only a unique generated schema is created/dropped; no product profile is used.
//! Unrelated GraphQL fields, production migrations, Supabase Auth/RLS, hosting,
//! realtime updates, work items, runs, and multi-user authorization are untested.

mod postgres_planning_support;

use sea_orm::{ConnectionTrait, DbBackend, Statement};
use serde_json::{json, Value};

use postgres_planning_support::{
    bootstrap, connect, local_test_url, native_data, start_planner, Client, PROJECT,
};

const CREATE_SPRINT: &str = r#"mutation($project: String!, $name: String!) {
    worktrackerSprintCreateOne(data: {projectId: $project, name: $name}) { id name status projectId }
}"#;
const UPDATE_SPRINT: &str = r#"mutation($id: String!, $name: String) {
    update_sprint(id: $id, name: $name) { id name status }
}"#;
const CREATE_GOAL: &str = r#"mutation($sprint: String!, $text: String!) {
    create_sprint_goal(sprint_id: $sprint, text: $text) { id sprintId position text }
}"#;
const UPDATE_GOAL: &str = r#"mutation($id: String!, $text: String!) {
    update_sprint_goal(id: $id, text: $text) { id sprintId position text }
}"#;
const READ: &str = r#"query($project: String!) {
    worktrackerSprint(filters: {projectId: {eq: $project}}, orderBy: {name: ASC}) {
        nodes { id name status projectId goalsRevisedAt
            project { id name }
            goals(orderBy: {position: ASC}) { nodes { id sprintId position text } }
        }
    }
}"#;

#[test]
fn postgres_fixture_rejects_nonlocal_and_ambiguous_urls() {
    for url in [
        "postgresql://user@127.0.0.1:5432/ticketry_test",
        "postgres://user@[::1]:5432/ticketry_test",
    ] {
        assert!(local_test_url(url).is_ok());
    }
    for url in [
        "postgresql://user@db.example.com/test",
        "postgresql://user@localhost/test",
        "postgresql:///test",
        "sqlite::memory:",
        "postgresql://user@127.0.0.1/",
        "postgresql://user@127.0.0.1/test?host=db.example.com",
        "postgresql://user@127.0.0.1/test?options=-csearch_path%3Dpublic",
        "postgresql://user@127.0.0.1/test#fragment",
    ] {
        assert!(local_test_url(url).is_err(), "accepted an unsafe test URL");
    }
}

#[tokio::test]
#[ignore = "requires explicit TEST_POSTGRES_URL for a disposable local PostgreSQL database"]
async fn postgres_planning_round_trip() {
    let url = local_test_url(
        &std::env::var("TEST_POSTGRES_URL")
            .expect("Set TEST_POSTGRES_URL to a disposable local PostgreSQL database"),
    )
    .unwrap();
    let schema = format!("ticketry_planner_poc_{}", uuid::Uuid::new_v4().simple());
    let admin = connect(&url, None).await;
    admin
        .execute_unprepared(&format!("CREATE SCHEMA \"{schema}\""))
        .await
        .unwrap();

    // Catch assertion panics through the join result so teardown still runs.
    let case_schema = schema.clone();
    let mut case = tokio::spawn(async move { round_trip(&url, &case_schema).await });
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(60), &mut case).await;
    if outcome.is_err() {
        case.abort();
        let _ = case.await;
    }
    let cleanup = admin
        .execute_unprepared(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
        .await;
    let absent = admin
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 FROM pg_namespace WHERE nspname = $1",
            [schema.into()],
        ))
        .await;
    admin.close().await.unwrap();
    cleanup.expect("Could not drop the generated PostgreSQL fixture schema");
    assert!(absent.unwrap().is_none(), "fixture schema survived cleanup");
    outcome
        .expect("PostgreSQL planning proof timed out")
        .expect("PostgreSQL planning proof failed; its fixture schema was removed");
}

async fn round_trip(url: &str, schema: &str) {
    let database = connect(url, Some(schema)).await;
    let active_schema: String = database
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT current_schema() AS name".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "name")
        .unwrap();
    assert_eq!(active_schema, schema);
    bootstrap(&database).await;
    let (planner, native) = start_planner(&database).await;
    let first = Client::new(planner.endpoint());
    let second = Client::new(planner.endpoint());
    first.assert_forbidden(None).await;
    first.assert_forbidden(Some("invalid-test-token")).await;

    let created = first
        .data(
            CREATE_SPRINT,
            json!({"project": PROJECT, "name": "  Postgres sprint  "}),
        )
        .await;
    let sprint = created["worktrackerSprintCreateOne"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(created["worktrackerSprintCreateOne"]["status"], "planned");
    assert_eq!(
        created["worktrackerSprintCreateOne"]["name"],
        "Postgres sprint"
    );
    assert_eq!(created["worktrackerSprintCreateOne"]["projectId"], PROJECT);
    let goal = second
        .data(
            CREATE_GOAL,
            json!({"sprint": sprint, "text": "  Shared via GraphQL  "}),
        )
        .await;
    let goal_id = goal["create_sprint_goal"]["id"].clone();
    assert_eq!(goal["create_sprint_goal"]["position"], 1);
    assert_eq!(goal["create_sprint_goal"]["text"], "Shared via GraphQL");
    first
        .data(
            UPDATE_GOAL,
            json!({"id": goal_id, "text": "Edited by the other client"}),
        )
        .await;
    second
        .data(
            UPDATE_SPRINT,
            json!({"id": sprint, "name": "Persisted planning"}),
        )
        .await;

    native_data(
        &native,
        UPDATE_GOAL,
        json!({"id": goal_id, "text": "Edited through the desktop transport"}),
    )
    .await;
    let before_invalid = read(&first).await;
    assert_eq!(
        native_data(&native, READ, json!({"project": PROJECT})).await,
        before_invalid
    );
    let rejected = second
        .response(UPDATE_GOAL, json!({"id": goal_id, "text": " "}))
        .await;
    assert!(rejected["errors"]
        .as_array()
        .is_some_and(|errors| !errors.is_empty()));
    // Invalid text rolls back the goal and the parent goalsRevisedAt write.
    assert_eq!(read(&first).await, before_invalid);

    let (one, two) = tokio::join!(
        first.data(
            CREATE_GOAL,
            json!({"sprint": sprint, "text": "Concurrent one"})
        ),
        second.data(
            CREATE_GOAL,
            json!({"sprint": sprint, "text": "Concurrent two"})
        ),
    );
    let mut positions = [
        one["create_sprint_goal"]["position"].as_i64().unwrap(),
        two["create_sprint_goal"]["position"].as_i64().unwrap(),
    ];
    positions.sort();
    assert_eq!(positions, [2, 3]);
    assert_eq!(
        second
            .data(
                "mutation($id: String!) { delete_sprint_goal(id: $id) }",
                json!({"id": one["create_sprint_goal"]["id"]})
            )
            .await["delete_sprint_goal"],
        true
    );

    let expected = read(&first).await;
    assert_eq!(read(&second).await, expected);
    let row = &expected["worktrackerSprint"]["nodes"][0];
    assert_eq!(row["project"]["id"], PROJECT);
    assert_eq!(row["name"], "Persisted planning");
    assert_eq!(row["goals"]["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(
        row["goals"]["nodes"][0]["text"],
        "Edited through the desktop transport"
    );

    let old_token = planner.endpoint().bearer_token.clone();
    planner.shutdown().await.unwrap();
    drop(first);
    drop(second);
    drop(native);
    database.close().await.unwrap();
    let reopened = connect(url, Some(schema)).await;
    let (restarted, restarted_native) = start_planner(&reopened).await;
    assert_ne!(restarted.endpoint().bearer_token, old_token);
    let fresh = Client::new(restarted.endpoint());
    fresh.assert_forbidden(Some(&old_token)).await;
    assert_eq!(read(&fresh).await, expected);
    assert_eq!(
        native_data(&restarted_native, READ, json!({"project": PROJECT})).await,
        expected
    );
    restarted.shutdown().await.unwrap();
    drop(restarted_native);
    reopened.close().await.unwrap();
}

async fn read(client: &Client) -> Value {
    client.data(READ, json!({"project": PROJECT})).await
}
