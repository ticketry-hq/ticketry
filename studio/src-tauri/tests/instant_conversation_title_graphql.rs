use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tauri_graphql::GraphQlEndpoint;

async fn database(url: &str) -> DatabaseConnection {
    let database = Database::connect(url).await.unwrap();
    database.execute_unprepared(
        "CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,
          status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER,
          error TEXT, cwd TEXT, provider_session_id TEXT, lifecycle_state TEXT,
          lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT, scope TEXT NOT NULL,
          launch_state TEXT, launch_model TEXT, initial_prompt TEXT, launch_reasoning TEXT,
          launch_unattended BOOL NOT NULL DEFAULT 0, attention_reason TEXT, conversation_title TEXT, stage_skill_availability TEXT);
         CREATE TABLE terminal_launch_material (
          effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL,
          request_id TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL, project_id TEXT NOT NULL,
          module_id TEXT NOT NULL, task_id TEXT NOT NULL, provider TEXT, profile TEXT, model TEXT,
          reasoning TEXT, scope TEXT NOT NULL, doc_rel_path TEXT, prompt TEXT,
          resume_from_agent_run_id TEXT, required_skills TEXT NOT NULL,
          working_directory_identity TEXT NOT NULL, design_directory_identity TEXT,
          initial_columns INTEGER NOT NULL, initial_rows INTEGER NOT NULL, created_at TEXT NOT NULL);
         INSERT INTO agent_runs (id, issue_id, agent, status, started_at, provider_session_id, lifecycle_state, scope) VALUES
          ('instant', 'module', 'claude', 'running', '2026-10-07', 'provider-session', 'awaiting_input', 'instant'),
          ('task', 'task', 'codex', 'running', '2026-10-07', NULL, 'running', 'task'),
          ('missing-material', 'module', 'codex', 'running', '2026-10-07', NULL, 'running', 'instant'),
          ('ended', 'module', 'codex', 'exited', '2026-10-07', NULL, 'idle', 'instant'),
          ('mismatched', 'another-issue', 'codex', 'running', '2026-10-07', NULL, 'running', 'instant');
         UPDATE agent_runs SET ended_at='2026-10-07' WHERE id='ended';
         INSERT INTO terminal_launch_material (
          effect_id, agent_run_id, schema_version, request_id, issue_id, project_id, module_id,
          task_id, scope, prompt, required_skills, working_directory_identity,
          initial_columns, initial_rows, created_at) VALUES
          ('e1', 'instant', 1, 'r1', 'module', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'module', 'instant', 'Original request', '[]', '/private', 80, 24, '2026-10-07'),
          ('e2', 'task', 1, 'r2', 'task', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'task', 'task', 'Task request', '[]', '/private', 80, 24, '2026-10-07'),
          ('e3', 'ended', 1, 'r3', 'module', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'module', 'instant', 'Old request', '[]', '/private', 80, 24, '2026-10-07'),
          ('e4', 'mismatched', 1, 'r4', 'module', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'module', 'instant', 'Wrong issue', '[]', '/private', 80, 24, '2026-10-07');"
    ).await.unwrap();
    database
}

async fn schema(database: DatabaseConnection) -> (GraphQlEndpoint, String) {
    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = ticketry_graphql_schema::foundation_schema(
        foundation,
        Some(database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let sdl = schema.sdl();
    (GraphQlEndpoint::new(schema), sdl)
}

async fn execute(endpoint: &GraphQlEndpoint, id: &str, title: &str) -> serde_json::Value {
    let request = serde_json::json!({
        "query": "mutation Rename($id: String!, $title: String!) { run: update_agent_run(id: $id, input: {conversationTitle: $title}) { id conversationTitle status lifecycleState providerSessionId } }",
        "variables": {"id": id, "title": title}
    });
    serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap()
}

#[tokio::test]
async fn title_update_contract_is_identity_bound_and_title_only() {
    let (endpoint, sdl) = schema(database("sqlite::memory:").await).await;
    assert!(sdl.contains("update_agent_run(id: String!, input: AgentRunUpdateInput!): AgentRuns!"));
    let input = sdl
        .split("input AgentRunUpdateInput {")
        .nth(1)
        .unwrap()
        .split('}')
        .next()
        .unwrap();
    assert_eq!(input.trim(), "conversationTitle: String!");
    for protected in [
        "status",
        "providerSessionId",
        "issueId",
        "scope",
        "lifecycleState",
    ] {
        let response = endpoint.execute_json(&serde_json::json!({
            "query": format!("mutation {{ update_agent_run(id: \"instant\", input: {{conversationTitle: \"Title\", {protected}: \"invalid\"}}) {{ id }} }}")
        }).to_string()).await;
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            response["errors"].is_array(),
            "protected field {protected} was accepted"
        );
    }
}

#[tokio::test]
async fn title_survives_database_reopen_and_projects_over_prompt_without_lifecycle_changes() {
    let directory = tempfile::tempdir().unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        directory.path().join("title.sqlite3").display()
    );
    let db = database(&url).await;
    let (endpoint, _) = schema(db.clone()).await;
    let response = execute(&endpoint, "instant", "  My renamed conversation  ").await;
    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"]["run"],
        serde_json::json!({
            "id": "instant", "conversationTitle": "My renamed conversation", "status": "running",
            "lifecycleState": "awaiting_input", "providerSessionId": "provider-session"
        })
    );
    drop(endpoint);
    db.close().await.unwrap();
    let reopened = Database::connect(&url).await.unwrap();
    let (endpoint, _) = schema(reopened).await;
    let response: serde_json::Value = serde_json::from_str(&endpoint.execute_json(
        r#"{"query":"{ tickets: instant_run_tickets(project_id: \"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\", module_id: \"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\") { agent_run_id title user_title } }"}"#
    ).await).unwrap();
    assert_eq!(response["errors"], serde_json::Value::Null);
    let ticket = response["data"]["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|ticket| ticket["agent_run_id"] == "instant")
        .unwrap();
    assert_eq!(ticket["title"], "My renamed conversation");
    assert_eq!(ticket["user_title"], "My renamed conversation");
}

#[tokio::test]
async fn blank_titles_and_ineligible_scopes_are_rejected_without_writes() {
    let (endpoint, _) = schema(database("sqlite::memory:").await).await;
    for (id, title) in [
        ("instant", " \n\t"),
        ("task", "Title"),
        ("missing-material", "Title"),
        ("missing", "Title"),
        ("ended", "Title"),
        ("mismatched", "Title"),
    ] {
        let response = execute(&endpoint, id, title).await;
        assert!(response["errors"].is_array(), "unexpected success for {id}");
    }
    let response = execute(&endpoint, "instant", "Valid title").await;
    assert_eq!(response["errors"], serde_json::Value::Null);
}
