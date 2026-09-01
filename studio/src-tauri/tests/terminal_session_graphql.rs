use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::GraphQlEndpoint;

async fn schema() -> (GraphQlEndpoint, String) {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_project (id TEXT PRIMARY KEY);\n\
             CREATE TABLE worktracker_issue (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);\n\
             CREATE TABLE agent_runs (\n\
               id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT NOT NULL,\n\
               model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,\n\
               ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,\n\
               lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,\n\
               scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT\n\
             );\n\
             CREATE TABLE agent_terminal_sessions (\n\
               agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL, task_id TEXT NOT NULL,\n\
               module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,\n\
               terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,\n\
               runtime_cleanup_pending INTEGER NOT NULL, runtime_namespace TEXT, output_identity TEXT,\n\
               output_sequence INTEGER NOT NULL, last_output_at TEXT, agent TEXT\n\
             );",
        )
        .await
        .unwrap();
    let namespace = ticketry_terminal::current_runtime_namespace().unwrap();
    let insert = format!(
        "INSERT INTO worktracker_project VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');\n\
         INSERT INTO worktracker_issue VALUES ('local-task', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');\n\
         INSERT INTO worktracker_issue VALUES ('foreign-task', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');\n\
         INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) VALUES\n\
           ('run-local', 'local-task', 'codex', 'running', '2026-08-19T10:00:00Z', 'task'),\n\
           ('run-runtime-foreign', 'local-task', 'codex', 'running', '2026-08-19T11:00:00Z', 'task'),\n\
           ('run-project-foreign', 'foreign-task', 'codex', 'running', '2026-08-19T12:00:00Z', 'task');\n\
         INSERT INTO agent_terminal_sessions VALUES\n\
           ('run-local', 'pt-private', '11111111111111111111111111111111', '22222222222222222222222222222222', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-19T10:00:00Z', NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex'),\n\
           ('run-runtime-foreign', 'pt-private-2', '11111111111111111111111111111111', '22222222222222222222222222222222', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-19T11:00:00Z', NULL, 'task', NULL, 0, 'other-runtime', NULL, 0, NULL, 'codex'),\n\
           ('run-project-foreign', 'pt-private-3', '11111111111111111111111111111111', '22222222222222222222222222222222', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-08-19T12:00:00Z', NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex');"
    );
    database.execute_unprepared(&insert).await.unwrap();

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

#[tokio::test]
async fn generated_read_scopes_filters_orders_paginates_and_loads_agent_run() {
    let (endpoint, _) = schema().await;
    let request = serde_json::json!({
        "query": "query Read($task: String!) { terminal_sessions: agentTerminalSessions(filters: { taskId: { eq: $task }, terminatedAt: { is_null: true } }, orderBy: { createdAt: DESC }, pagination: { offset: { limit: 10, offset: 0 } }) { sessions: nodes { agent_run_id: agentRunId created_at: createdAt agent_run: agentRun { id status launchState launchModel } } } }",
        "variables": { "task": "11111111-1111-1111-1111-111111111111" }
    });
    let response: serde_json::Value =
        serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"]["terminal_sessions"]["sessions"],
        serde_json::json!([{
            "agent_run_id": "run-local",
            "created_at": "2026-08-19T10:00:00Z",
            "agent_run": { "id": "run-local", "status": "running", "launchState": null, "launchModel": null }
        }])
    );
}

#[tokio::test]
async fn public_sdl_excludes_runtime_and_launch_material() {
    let (_, sdl) = schema().await;
    for protected in [
        "tmuxSessionName",
        "runtimeNamespace",
        "runtimeCleanupPending",
        "outputIdentity",
        "cwd:",
        "designDir",
        "terminalLaunchMaterial",
        "terminalCleanupEffects",
        "agentTerminalSessionsCreate",
    ] {
        assert!(!sdl.contains(protected), "public SDL contains {protected}");
    }
}

#[tokio::test]
async fn terminal_create_action_decision_keeps_the_full_sdl_and_entity_result() {
    let actual = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .expect("build shipping schema");
    let checked_in = include_str!("../../src/graphql-foundation/generated/schema.graphql");
    assert_eq!(actual.trim(), checked_in.trim(), "full SDL drifted");
    assert!(actual.contains(
        "terminal_session_create(client_request_id: String!, project_id: String, issue_id: String, module_id: String!, target_id: String, kind: String!, provider: String, working_directory_identity: String, columns: Int!, rows: Int!, model: String, reasoning: String, policy_reference: String, prompt: String, resume_from_agent_run_id: String, automation_attempt_id: String, required_skills: [String!], design_directory_identity: String, document_relative_path: String): AgentTerminalSessions!"
    ));
}
