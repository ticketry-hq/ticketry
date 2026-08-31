use std::sync::{Mutex, Once};

use log::{LevelFilter, Log, Metadata, Record};
use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::GraphQlEndpoint;

static INSTALL_LOGGER: Once = Once::new();
static SQL_MESSAGES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static SQL_LOGGER: SqlLogger = SqlLogger;

struct SqlLogger;

impl Log for SqlLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == "sqlx::query"
    }

    fn log(&self, record: &Record<'_>) {
        if self.enabled(record.metadata()) {
            SQL_MESSAGES.lock().unwrap().push(record.args().to_string());
        }
    }

    fn flush(&self) {}
}

fn capture_sql() {
    INSTALL_LOGGER.call_once(|| {
        log::set_logger(&SQL_LOGGER).expect("install SQL logger");
        log::set_max_level(LevelFilter::Info);
    });
    SQL_MESSAGES.lock().unwrap().clear();
}

async fn schema() -> GraphQlEndpoint {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_unprepared(
            r#"
            CREATE TABLE worktracker_project (id TEXT PRIMARY KEY);
            CREATE TABLE worktracker_issue (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
                issue_type_id TEXT NOT NULL, parent_id TEXT, module_id TEXT, state_id TEXT,
                state_revision INTEGER NOT NULL, name TEXT NOT NULL, sequence_id INTEGER NOT NULL,
                is_archived INTEGER NOT NULL, rank TEXT NOT NULL, description TEXT NOT NULL,
                workspace_tab_order JSON NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE agent_runs (
                id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,
                status TEXT NOT NULL, started_at TEXT NOT NULL,
                ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
                lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
                scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT, initial_prompt TEXT,
                launch_reasoning TEXT, launch_unattended BOOL NOT NULL DEFAULT 0
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL, task_id TEXT NOT NULL,
                module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
                terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,
                runtime_cleanup_pending INTEGER NOT NULL, runtime_namespace TEXT,
                output_identity TEXT, output_sequence INTEGER NOT NULL, last_output_at TEXT,
                agent TEXT
            );
            INSERT INTO worktracker_project VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            INSERT INTO worktracker_issue VALUES
              ('11111111111111111111111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'task',
               'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NULL, NULL, NULL, 1, 'First', 1, 0, 'A', '',
               '[]',
               '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z'),
              ('22222222222222222222222222222222', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'task',
               'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NULL, NULL, NULL, 1, 'Second', 2, 0, 'B', '',
               '[]',
               '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z');
            INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) VALUES
              ('run-first-local', '11111111111111111111111111111111', 'codex', 'running',
               '2026-08-26T00:00:00Z', 'task'),
              ('run-first-foreign-runtime', '11111111111111111111111111111111', 'codex', 'running',
               '2026-08-26T00:01:00Z', 'task'),
              ('run-second-local', '22222222222222222222222222222222', 'codex', 'running',
               '2026-08-26T00:02:00Z', 'task');
            "#,
        )
        .await
        .unwrap();
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions VALUES
              ('run-first-local', 'pt-first', '11111111111111111111111111111111',
               '11111111111111111111111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               '2026-08-26T00:00:00Z', NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex'),
              ('run-first-foreign-runtime', 'pt-foreign', '11111111111111111111111111111111',
               '11111111111111111111111111111111', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               '2026-08-26T00:01:00Z', NULL, 'task', NULL, 0, 'other-runtime', NULL, 0, NULL, 'codex'),
              ('run-second-local', 'pt-second', '22222222222222222222222222222222',
               '22222222222222222222222222222222', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               '2026-08-26T00:02:00Z', NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex');"
        ))
        .await
        .unwrap();

    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let schema = muxed_studio_lib::query_root::foundation_schema(
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
    GraphQlEndpoint::new(schema)
}

#[tokio::test]
async fn issue_agent_runs_are_runtime_scoped_and_loaded_in_one_batch() {
    capture_sql();
    let endpoint = schema().await;
    SQL_MESSAGES.lock().unwrap().clear();

    let request = serde_json::json!({
        "query": "query { worktrackerIssue(orderBy: { sequenceId: ASC }) { nodes { name agentRuns { nodes { id } } } } }"
    });
    let response: serde_json::Value =
        serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    assert_eq!(
        response["data"]["worktrackerIssue"]["nodes"],
        serde_json::json!([
            { "name": "First", "agentRuns": { "nodes": [{ "id": "run-first-local" }] } },
            { "name": "Second", "agentRuns": { "nodes": [{ "id": "run-second-local" }] } }
        ])
    );

    let messages = SQL_MESSAGES.lock().unwrap();
    let relation_queries = messages
        .iter()
        .filter(|message| message.contains(r#"FROM \"agent_runs\""#))
        .collect::<Vec<_>>();
    assert_eq!(relation_queries.len(), 1, "captured SQL: {messages:#?}");
    assert!(
        relation_queries[0].contains(" IN "),
        "relation was not loaded with one batched IN query: {}",
        relation_queries[0]
    );
}
