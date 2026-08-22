//! A minimal Runs store for status-stream tests: the adopted Agent Run and
//! Automation Attempt tables, the durable outbox, and just enough WorkTracker
//! scope for two projects.
#![allow(dead_code)]

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

pub const PROJECT: &str = "11111111111111111111111111111111";
pub const PUBLIC_PROJECT: &str = "11111111-1111-1111-1111-111111111111";
pub const FOREIGN_PROJECT: &str = "22222222222222222222222222222222";
pub const PUBLIC_FOREIGN_PROJECT: &str = "22222222-2222-2222-2222-222222222222";
pub const TASK: &str = "33333333333333333333333333333333";
pub const MODULE: &str = "44444444444444444444444444444444";
pub const FOREIGN_TASK: &str = "55555555555555555555555555555555";

pub async fn open() -> (tempfile::TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    database.execute_unprepared(&format!(r#"
        CREATE TABLE worktracker_issue (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, module_id TEXT
        );
        CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT NOT NULL,
            model TEXT, reasoning TEXT,
            status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER,
            error TEXT, cwd TEXT, provider_session_id TEXT, lifecycle_state TEXT,
            lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT, scope TEXT NOT NULL,
            launch_state TEXT, launch_model TEXT
        );
        CREATE TABLE runs_status_events (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
            subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
            automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
            committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE agent_terminal_sessions (
            agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL,
            task_id TEXT NOT NULL, module_id TEXT NOT NULL, project_id TEXT NOT NULL,
            created_at TEXT NOT NULL, terminated_at TEXT, scope TEXT NOT NULL,
            doc_rel_path TEXT, runtime_cleanup_pending BOOL NOT NULL DEFAULT 0,
            runtime_namespace TEXT, output_identity TEXT,
            output_sequence INTEGER NOT NULL DEFAULT 0, last_output_at TEXT, agent TEXT
        );
        CREATE INDEX idx_runs_status_events_project_cursor
            ON runs_status_events(project_id, cursor);
        CREATE INDEX idx_runs_status_events_project_committed
            ON runs_status_events(project_id, committed_at);
        CREATE TABLE automation_attempts (
            id TEXT PRIMARY KEY, transition_id TEXT NOT NULL, issue_id TEXT NOT NULL,
            from_state_id TEXT NOT NULL, to_state_id TEXT NOT NULL, workflow_revision INTEGER NOT NULL,
            status TEXT NOT NULL, agent TEXT, agent_run_id TEXT, error TEXT, error_details TEXT,
            retryable BOOL NOT NULL DEFAULT 1, dismissed_at TEXT, retry_of_id TEXT,
            root_attempt_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE runs_project_compaction_watermarks (
            project_id TEXT PRIMARY KEY, compacted_through_cursor INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE runs_launch_effects (
            effect_id TEXT PRIMARY KEY, intent_version INTEGER NOT NULL DEFAULT 1,
            agent_run_id TEXT NOT NULL, automation_attempt_id TEXT,
            request_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, issue_id TEXT NOT NULL,
            scope TEXT NOT NULL, provider TEXT NOT NULL, target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL, policy_reference TEXT, state TEXT NOT NULL DEFAULT 'prepared',
            lease_owner TEXT, lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error_code TEXT, last_error_message TEXT, runtime_evidence TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_at TEXT
        );
        INSERT INTO worktracker_issue VALUES
            ('{MODULE}','{PROJECT}','module',NULL),
            ('{TASK}','{PROJECT}','task','{MODULE}'),
            ('{FOREIGN_TASK}','{FOREIGN_PROJECT}','task',NULL);
    "#)).await.unwrap();
    (directory, database)
}

pub async fn insert_run(database: &DatabaseConnection, id: &str, issue: &str, started: &str) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope)
               VALUES (?, ?, 'codex', 'running', ?, 'task')"#,
            [id.into(), issue.into(), started.into()],
        ))
        .await
        .unwrap();
}

pub async fn insert_run_with_launch_snapshot(
    database: &DatabaseConnection,
    id: &str,
    issue: &str,
    started: &str,
    launch_state: &str,
    launch_model: &str,
) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO agent_runs
               (id, issue_id, agent, status, started_at, scope, launch_state, launch_model)
               VALUES (?, ?, 'codex', 'running', ?, 'task', ?, ?)"#,
            [
                id.into(),
                issue.into(),
                started.into(),
                launch_state.into(),
                launch_model.into(),
            ],
        ))
        .await
        .unwrap();
}

/// Append a raw outbox row. Only tests that need a foreign project or a
/// payload version this build cannot read use this; every other test commits
/// through the authored commands.
pub async fn insert_event(
    database: &DatabaseConnection,
    project_id: &str,
    kind: &str,
    payload_version: i32,
    payload: &str,
) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO runs_status_events
               (event_id, project_id, event_kind, payload_version, subject_kind, subject_id, payload)
               VALUES (?, ?, ?, ?, 'agent_run', 'subject', ?)"#,
            [
                uuid::Uuid::new_v4().simple().to_string().into(),
                project_id.into(),
                kind.into(),
                payload_version.into(),
                payload.into(),
            ],
        ))
        .await
        .unwrap();
}
