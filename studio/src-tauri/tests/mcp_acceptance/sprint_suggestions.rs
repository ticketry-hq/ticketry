use std::sync::Arc;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient};

use super::{prepare_command_database, MissingTerminalRuntime, MODULE};

const SPRINT: &str = "80000000-0000-0000-0000-000000000001";
const GOAL: &str = "80000000-0000-0000-0000-000000000002";
const FOREIGN: &str = "80000000-0000-0000-0000-000000000003";
const STORY: &str = "30000000-0000-0000-0000-000000000000";

fn proposal() -> Value {
    json!({"sprint_id": SPRINT, "goal_id": GOAL, "proposed_name": "Ship planning",
        "proposed_epic_id": MODULE, "reason": "Supports the planning goal"})
}

async fn assert_suggestion_only(client: &mut SocketClient) {
    let listed = client
        .request(json!({"jsonrpc":"2.0", "id":30, "method":"tools/list"}))
        .await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    for name in [
        "list_tasks",
        "get_sprint_goals",
        "suggest_sprint_story",
        "terminate_current_run",
    ] {
        assert!(
            tools.iter().any(|tool| tool["name"] == name),
            "missing {name}: {listed}"
        );
    }
    assert!(!tools
        .iter()
        .any(|tool| tool["name"] == "update_task" || tool["name"] == "create_task"));
    for (id, name, arguments) in [
        (
            31,
            "update_task",
            json!({"id_or_key": STORY, "name": "Unapproved edit"}),
        ),
        (
            32,
            "create_task",
            json!({"project_id": super::PROJECT, "name": "Unapproved story", "issue_type": "Story"}),
        ),
    ] {
        let rejected = client.structured(id, name, arguments).await;
        assert_eq!(rejected["error"], "tool_not_allowed", "{rejected}");
    }
}

#[tokio::test]
async fn sprint_tools_enforce_project_open_sprint_and_current_run_without_assignment() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    database.execute_unprepared(r#"
        UPDATE worktracker_issue SET issue_type_id = '30000000000000000000000000000001'
            WHERE id = '30000000000000000000000000000000';
        INSERT INTO worktracker_project VALUES
            ('90000000000000000000000000000000', 'Foreign', 'FOREIGN', '', 0, 0,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
        INSERT INTO worktracker_sprint
            (id, project_id, name, status, suggestion_run_id, created_at, updated_at) VALUES
            ('80000000000000000000000000000001', '10000000000000000000000000000000',
             'Planning', 'planned', 'run-valid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('80000000000000000000000000000003', '90000000000000000000000000000000',
             'Foreign sprint', 'planned', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO worktracker_sprint_goal (id, sprint_id, position, text, created_at, updated_at) VALUES
            ('80000000000000000000000000000002', '80000000000000000000000000000001', 1,
             'Ship planning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('80000000000000000000000000000004', '80000000000000000000000000000001', 2,
             'Polish planning', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope, launch_state) VALUES
            ('run-next', '30000000000000000000000000000000', 'codex', 'running',
             '2026-08-15T00:00:00+00:00', 'task', 'Building');
    "#).await.unwrap();
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(ticketry_work_management::commands::CommandDatabase(
            database.clone(),
        )),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let bound = schema
        .execute(seaography::async_graphql::Request::new(format!(
            "mutation {{ update_sprint(id: \"{SPRINT}\", suggestion_run_id: \"run-valid\") {{ id }} }}"
        )))
        .await;
    assert!(bound.errors.is_empty(), "{:?}", bound.errors);
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    for (run, token) in [("run-valid", "valid"), ("run-next", "next")] {
        runtime
            .grant_for_test(run, token, allowed_provider_operations(), false)
            .await
            .unwrap();
    }
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    let listed = client
        .request(json!({"jsonrpc":"2.0", "id":1, "method":"tools/list"}))
        .await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert!(tools
        .iter()
        .any(|tool| tool["name"] == "suggest_sprint_story"));
    assert!(!tools
        .iter()
        .any(|tool| tool["name"] == "update_task" || tool["name"] == "create_task"));
    assert!(!tools
        .iter()
        .any(|tool| tool["name"].as_str().unwrap().contains("assign")));
    let goals = client
        .structured(2, "get_sprint_goals", json!({"sprint_id": SPRINT}))
        .await;
    assert_eq!(goals["name"], "Planning", "{goals}");
    assert_eq!(goals["status"], "planned");
    assert_eq!(goals["goals"][0]["number"], "G1");
    assert_eq!(goals["goals"][1]["number"], "G2");
    for (id, tool, arguments) in [
        (3, "get_sprint_goals", json!({"sprint_id": FOREIGN})),
        (4, "suggest_sprint_story", {
            let mut p = proposal();
            p["sprint_id"] = json!(FOREIGN);
            p
        }),
    ] {
        let rejected = client.structured(id, tool, arguments).await;
        assert_eq!(rejected["code"], "foreign_scope", "{rejected}");
    }
    let mut missing_epic = proposal();
    missing_epic["proposed_epic_id"] = Value::Null;
    let rejected = client
        .structured(5, "suggest_sprint_story", missing_epic)
        .await;
    assert_eq!(rejected["ok"], false, "{rejected}");
    let proposed = client
        .structured(6, "suggest_sprint_story", proposal())
        .await;
    assert_eq!(proposed["status"], "waiting", "{proposed}");
    assert_eq!(proposed["issue_id"], Value::Null);
    let existing = client
        .structured(
            7,
            "suggest_sprint_story",
            json!({
                "sprint_id": SPRINT, "goal_id": GOAL, "issue_id": STORY,
                "proposed_name": null, "proposed_epic_id": null, "reason": "Fits the goal",
            }),
        )
        .await;
    assert_eq!(existing["status"], "waiting", "{existing}");
    let untouched = database.query_one_raw(sea_orm::Statement::from_string(sea_orm::DbBackend::Sqlite,
        "SELECT sprint_id, (SELECT COUNT(*) FROM worktracker_issue) AS stories FROM worktracker_issue WHERE id = '30000000000000000000000000000000'".to_owned())).await.unwrap().unwrap();
    assert_eq!(
        untouched
            .try_get::<Option<String>>("", "sprint_id")
            .unwrap(),
        None
    );
    assert_eq!(untouched.try_get::<i64>("", "stories").unwrap(), 2);
    let accepted = schema
        .execute(seaography::async_graphql::Request::new(format!(
            "mutation {{ update_sprint_suggestion(id: \"{}\", status: \"accepted\") {{ id status issue {{ id sprintId }} }} }}",
            existing["id"].as_str().unwrap(),
        )))
        .await;
    assert!(accepted.errors.is_empty(), "{:?}", accepted.errors);
    let accepted = accepted.data.into_json().unwrap();
    assert_eq!(
        accepted["update_sprint_suggestion"]["issue"]["sprintId"],
        SPRINT
    );
    let accepted_row = client
        .structured(
            13,
            "suggest_sprint_story",
            json!({
                "sprint_id": SPRINT, "goal_id": GOAL, "issue_id": STORY,
                "reason": "Fits the goal",
            }),
        )
        .await;
    assert_eq!(accepted_row["id"], existing["id"], "{accepted_row}");
    assert_eq!(accepted_row["status"], "accepted", "{accepted_row}");
    let mut waiting_proposal = proposal();
    waiting_proposal["proposed_name"] = json!("Unreviewed planning work");
    let waiting = client
        .structured(14, "suggest_sprint_story", waiting_proposal)
        .await;
    assert_eq!(waiting["status"], "waiting", "{waiting}");
    let mut next =
        SocketClient::connect_run(runtime.socket_path(), "run-next", "Bearer next").await;
    let before_binding = next
        .request(json!({"jsonrpc":"2.0", "id":19, "method":"tools/list"}))
        .await;
    for name in ["create_task", "update_task"] {
        assert!(
            before_binding["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == name),
            "{before_binding}"
        );
    }
    let premature = next.structured(8, "suggest_sprint_story", proposal()).await;
    assert_eq!(premature["code"], "run_not_current", "{premature}");

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_sprint_suggestion SET status = 'dismissed' WHERE id = '{}'",
            proposed["id"].as_str().unwrap(),
        ))
        .await
        .unwrap();
    // Set up a re-run through the host's restricted sprint update. Assertions stay on MCP and persistence.
    let rotated = schema
        .execute(seaography::async_graphql::Request::new(format!(
        "mutation {{ update_sprint(id: \"{SPRINT}\", suggestion_run_id: \"run-next\") {{ id }} }}"
    )))
        .await;
    assert!(rotated.errors.is_empty(), "{:?}", rotated.errors);
    let replaced = database.query_one_raw(sea_orm::Statement::from_string(
        sea_orm::DbBackend::Sqlite,
        "SELECT suggestion_run_id, (SELECT COUNT(*) FROM worktracker_sprint_suggestion WHERE status = 'waiting') AS waiting, (SELECT COUNT(*) FROM worktracker_sprint_suggestion WHERE status = 'dismissed') AS dismissed FROM worktracker_sprint WHERE id = '80000000000000000000000000000001'".to_owned(),
    )).await.unwrap().unwrap();
    assert_eq!(
        replaced.try_get::<String>("", "suggestion_run_id").unwrap(),
        "run-next"
    );
    assert_eq!(replaced.try_get::<i64>("", "waiting").unwrap(), 0);
    assert_eq!(replaced.try_get::<i64>("", "dismissed").unwrap(), 1);
    let stale = client
        .structured(9, "suggest_sprint_story", proposal())
        .await;
    assert_eq!(stale["code"], "run_not_current", "{stale}");
    let current = next
        .structured(10, "suggest_sprint_story", proposal())
        .await;
    assert_eq!(current["id"], proposed["id"], "{current}");
    assert_eq!(current["status"], "dismissed", "{current}");
    let resubmitted = next
        .structured(
            15,
            "suggest_sprint_story",
            json!({
                "sprint_id": SPRINT, "goal_id": "80000000-0000-0000-0000-000000000004",
                "issue_id": STORY, "reason": "A different explanation on the next run",
            }),
        )
        .await;
    assert_eq!(resubmitted, accepted_row);
    let reviewed = database.query_one_raw(sea_orm::Statement::from_string(
        sea_orm::DbBackend::Sqlite,
        "SELECT COUNT(*) AS total, SUM(status = 'waiting') AS waiting, SUM(status = 'accepted') AS accepted, SUM(status = 'dismissed') AS dismissed FROM worktracker_sprint_suggestion".to_owned(),
    )).await.unwrap().unwrap();
    assert_eq!(reviewed.try_get::<i64>("", "total").unwrap(), 2);
    assert_eq!(reviewed.try_get::<i64>("", "waiting").unwrap(), 0);
    assert_eq!(reviewed.try_get::<i64>("", "accepted").unwrap(), 1);
    assert_eq!(reviewed.try_get::<i64>("", "dismissed").unwrap(), 1);
    for caller in [&mut client, &mut next] {
        assert_suggestion_only(caller).await;
    }
    let unchanged = database.query_one_raw(sea_orm::Statement::from_string(sea_orm::DbBackend::Sqlite,
        "SELECT sprint_id, (SELECT COUNT(*) FROM worktracker_issue) AS stories FROM worktracker_issue WHERE id = '30000000000000000000000000000000'".to_owned())).await.unwrap().unwrap();
    assert_eq!(
        unchanged
            .try_get::<Option<String>>("", "sprint_id")
            .unwrap(),
        Some(SPRINT.replace('-', ""))
    );
    assert_eq!(unchanged.try_get::<i64>("", "stories").unwrap(), 2);
    runtime
        .grant_for_test(
            "run-next",
            "refreshed",
            allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();
    let mut refreshed =
        SocketClient::connect_run(runtime.socket_path(), "run-next", "Bearer refreshed").await;
    assert_suggestion_only(&mut refreshed).await;
    let backlog = refreshed
        .structured(33, "list_tasks", json!({"project_id": super::PROJECT}))
        .await;
    assert!(
        backlog["result"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == STORY),
        "{backlog}"
    );
    drop(client);
    drop(next);
    drop(refreshed);
    runtime.shutdown().await;
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    let mut next =
        SocketClient::connect_run(runtime.socket_path(), "run-next", "Bearer refreshed").await;
    for caller in [&mut client, &mut next] {
        assert_suggestion_only(caller).await;
    }
    let goals = next
        .structured(34, "get_sprint_goals", json!({"sprint_id": SPRINT}))
        .await;
    assert_eq!(goals["name"], "Planning", "{goals}");
    let current = next
        .structured(35, "suggest_sprint_story", proposal())
        .await;
    assert_eq!(current["status"], "dismissed", "{current}");
    let cleared = schema
        .execute(seaography::async_graphql::Request::new(format!(
            "mutation {{ update_sprint(id: \"{SPRINT}\", suggestion_run_id: null) {{ id }} }}"
        )))
        .await;
    assert!(cleared.errors.is_empty(), "{:?}", cleared.errors);
    for caller in [&mut client, &mut next] {
        assert_suggestion_only(caller).await;
        let stale = caller
            .structured(36, "suggest_sprint_story", proposal())
            .await;
        assert_eq!(stale["code"], "run_not_current", "{stale}");
    }
    database.execute_unprepared("UPDATE worktracker_sprint SET status = 'completed' WHERE id = '80000000000000000000000000000001'")
        .await.unwrap();
    for (id, tool, arguments) in [
        (11, "get_sprint_goals", json!({"sprint_id": SPRINT})),
        (12, "suggest_sprint_story", proposal()),
    ] {
        let closed = next.structured(id, tool, arguments).await;
        assert_eq!(closed["ok"], false, "{closed}");
        assert!(
            closed["detail"].as_str().unwrap().contains("completed"),
            "{closed}"
        );
    }
    let terminated = client
        .structured(37, "terminate_current_run", json!({}))
        .await;
    assert_eq!(terminated["agent_run_id"], "run-valid", "{terminated}");
    assert_eq!(terminated["termination_requested"], true, "{terminated}");
    super::wait_for_terminal_record(&directory).await;
    runtime.shutdown().await;
    database.close().await.unwrap();
}
