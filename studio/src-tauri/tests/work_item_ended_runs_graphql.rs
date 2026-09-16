//! The Work Item read that owns ended Agent Runs (CODING-1519).
//!
//! The run status stream carries live runs only, so a reopened Story restores
//! its ended runs through the generated WorkItem-to-AgentRuns connection:
//! terminal-state filtering, started-at ordering, and the Terminal Session
//! record whose `terminatedAt` says whether the run is still resumable: null is
//! a live tmux session to reattach, a timestamp is a session that is gone. No
//! calendar cutoff, and no custom domain operation.

use sea_orm::{ConnectionTrait, Database};
use tauri_graphql::GraphQlEndpoint;

const STORY: &str = "11111111111111111111111111111111";

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
                status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER,
                error TEXT, cwd TEXT, provider_session_id TEXT, lifecycle_state TEXT,
                lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT, scope TEXT NOT NULL,
                launch_state TEXT, launch_model TEXT, initial_prompt TEXT, launch_reasoning TEXT,
                launch_unattended INTEGER NOT NULL DEFAULT 0
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
               'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NULL, NULL, NULL, 1, 'Story', 1, 0, 'A', '',
               '[]', '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z');
            INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, scope)
            VALUES
              -- Ended long before any window the snapshot used to apply, and
              -- its terminal session is still live: age is not the rule.
              ('run-ancient', '11111111111111111111111111111111', 'codex', 'exited',
               '2019-03-01T09:00:00Z', '2019-03-01T09:30:00Z', 'task'),
              -- Equally old, but its terminal session was terminated.
              ('run-ancient-terminated', '11111111111111111111111111111111', 'codex',
               'exited', '2019-02-01T09:00:00Z', '2019-02-01T09:30:00Z', 'task'),
              ('run-ended-late', '11111111111111111111111111111111', 'codex', 'exited',
               '2026-08-25T23:00:00Z', '2026-08-25T23:30:00Z', 'task'),
              ('run-live', '11111111111111111111111111111111', 'codex', 'running',
               '2026-08-26T00:00:00Z', NULL, 'task');
            "#,
        )
        .await
        .unwrap();
    let namespace = ticketry_terminal::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions VALUES
              ('run-ancient', 'pt-ancient', '{STORY}', '{STORY}',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2019-03-01T09:00:00Z',
               NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex'),
              ('run-ancient-terminated', 'pt-ancient-terminated', '{STORY}', '{STORY}',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2019-02-01T09:00:00Z',
               '2019-02-01T09:31:00Z', 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex'),
              ('run-ended-late', 'pt-late', '{STORY}', '{STORY}',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-25T23:00:00Z',
               NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex'),
              ('run-live', 'pt-live', '{STORY}', '{STORY}',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-26T00:00:00Z',
               NULL, 'task', NULL, 0, '{namespace}', NULL, 0, NULL, 'codex');"
        ))
        .await
        .unwrap();

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
    GraphQlEndpoint::new(schema)
}

#[tokio::test]
async fn work_item_ended_agent_runs_carry_their_terminal_session_record() {
    let endpoint = schema().await;

    let request = serde_json::json!({
        "query": r#"query {
            worktrackerIssue(filters: { id: { eq: "11111111-1111-1111-1111-111111111111" } }) {
                nodes {
                    agentRuns(
                        filters: { endedAt: { is_null: false }, scope: { eq: "task" } }
                        orderBy: { startedAt: DESC }
                    ) {
                        nodes {
                            id
                            status
                            startedAt
                            terminalSession { nodes { agentRunId terminatedAt } }
                        }
                    }
                }
            }
        }"#
    });
    let response: serde_json::Value =
        serde_json::from_str(&endpoint.execute_json(&request.to_string()).await).unwrap();

    assert_eq!(response["errors"], serde_json::Value::Null, "{response:#}");
    assert_eq!(
        response["data"]["worktrackerIssue"]["nodes"][0]["agentRuns"]["nodes"],
        serde_json::json!([
            {
                "id": "run-ended-late",
                "status": "exited",
                "startedAt": "2026-08-25T23:00:00Z",
                "terminalSession": { "nodes": [
                    { "agentRunId": "run-ended-late", "terminatedAt": null }
                ] }
            },
            {
                // Age is not the rule: this run is restorable because its
                // Terminal Session is still live, seven years after it ended.
                "id": "run-ancient",
                "status": "exited",
                "startedAt": "2019-03-01T09:00:00Z",
                "terminalSession": { "nodes": [
                    { "agentRunId": "run-ancient", "terminatedAt": null }
                ] }
            },
            {
                // Carried with its `terminatedAt`, which is how the reader knows
                // this run has no tmux session left to reattach.
                "id": "run-ancient-terminated",
                "status": "exited",
                "startedAt": "2019-02-01T09:00:00Z",
                "terminalSession": { "nodes": [
                    {
                        "agentRunId": "run-ancient-terminated",
                        "terminatedAt": "2019-02-01T09:31:00Z"
                    }
                ] }
            }
        ]),
        "{response:#}"
    );
}
