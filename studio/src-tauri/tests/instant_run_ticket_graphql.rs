use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::GraphQlEndpoint;

const PROJECT_ID: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MODULE_ID: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

async fn schema() -> (GraphQlEndpoint, String) {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            "CREATE TABLE agent_runs (\n\
               id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,\n\
               model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,\n\
               ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,\n\
               lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,\n\
               scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT\n\
             );\n\
             CREATE TABLE terminal_launch_material (\n\
               effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL,\n\
               request_id TEXT NOT NULL UNIQUE, issue_id TEXT NOT NULL, project_id TEXT NOT NULL,\n\
               module_id TEXT NOT NULL, task_id TEXT NOT NULL, provider TEXT, model TEXT, reasoning TEXT,\n\
               scope TEXT NOT NULL, doc_rel_path TEXT, prompt TEXT, resume_from_agent_run_id TEXT,\n\
               required_skills TEXT NOT NULL, working_directory_identity TEXT NOT NULL,\n\
               design_directory_identity TEXT, initial_columns INTEGER NOT NULL, initial_rows INTEGER NOT NULL,\n\
               created_at TEXT NOT NULL\n\
             );",
        )
        .await
        .unwrap();
    let prompt = "Private /workspace context\n\nUser's request:\n  Itemize temporary chats\n\nYour job:\n  hidden instructions";
    let sql_prompt = prompt.replace('\'', "''");
    let project = PROJECT_ID.replace('-', "");
    let module = MODULE_ID.replace('-', "");
    let foreign_module = "cccccccccccccccccccccccccccccccc";
    let insert = format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, scope) VALUES\n\
           ('run-active', 'scratch', 'codex', 'running', '2026-08-30T10:00:00Z', NULL, 'instant'),\n\
           ('run-ended', 'scratch', 'codex', 'exited', '2026-08-30T09:00:00Z', '2026-08-30T09:30:00Z', 'instant'),\n\
           ('run-plan', 'scratch', 'codex', 'running', '2026-08-30T08:00:00Z', NULL, 'plan'),\n\
           ('run-foreign', 'scratch', 'codex', 'running', '2026-08-30T07:00:00Z', NULL, 'instant');\n\
         INSERT INTO terminal_launch_material VALUES\n\
           ('effect-active', 'run-active', 1, 'request-active', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T10:00:00Z'),\n\
           ('effect-ended', 'run-ended', 1, 'request-ended', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T09:00:00Z'),\n\
           ('effect-plan', 'run-plan', 1, 'request-plan', 'scratch', '{project}', '{module}', 'scratch', 'codex', NULL, NULL, 'plan', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T08:00:00Z'),\n\
           ('effect-foreign', 'run-foreign', 1, 'request-foreign', 'scratch', '{project}', '{foreign_module}', 'scratch', 'codex', NULL, NULL, 'instant', NULL, '{sql_prompt}', NULL, '[]', '/private/repo', NULL, 80, 24, '2026-08-30T07:00:00Z');"
    );
    database.execute_unprepared(&insert).await.unwrap();

    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = ticketry_graphql_schema::query_root::foundation_schema(
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
async fn active_instant_runs_are_projected_as_titled_tickets() {
    let (endpoint, _) = schema().await;
    let request = serde_json::json!({
        "query": "query Tickets($project: String!, $module: String!) { tickets: instant_run_tickets(project_id: $project, module_id: $module) { agent_run_id title started_at } }",
        "variables": { "project": PROJECT_ID, "module": MODULE_ID }
    });
    let response: serde_json::Value =
        serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null);
    assert_eq!(
        response["data"]["tickets"],
        serde_json::json!([{
            "agent_run_id": "run-active",
            "title": "Itemize temporary chats",
            "started_at": "2026-08-30T10:00:00Z"
        }])
    );
}

#[tokio::test]
async fn launch_material_stays_out_of_the_public_contract() {
    let (_, sdl) = schema().await;

    assert!(sdl.contains("instant_run_tickets"));
    assert!(sdl.contains("type InstantRunTicket"));
    assert!(!sdl.contains("terminalLaunchMaterial"));
    let ticket_output = sdl
        .split_once("type InstantRunTicket {")
        .and_then(|(_, tail)| tail.split_once('}').map(|(block, _)| block))
        .expect("InstantRunTicket SDL block");
    assert!(!ticket_output.contains("prompt"));
    assert!(!ticket_output.contains("working_directory"));
    assert!(!ticket_output.contains("design_directory"));
    assert!(!ticket_output.contains("required_skills"));
}

#[tokio::test]
async fn instant_ticket_projection_is_bounded() {
    assert_eq!(
        ticketry_terminal::terminal::instant_run_ticket::INSTANT_RUN_TICKET_LIMIT,
        100
    );
}
