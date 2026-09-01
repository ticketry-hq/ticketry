use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use ticketry_runs::{
    AgentRunHolding, LifecycleFact, RunsServices, TerminalFact, TerminalOutcome,
};

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, RunsServices) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    database.execute_unprepared(r#"
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
        CREATE TABLE agent_terminal_sessions (
            agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL,
            task_id TEXT NOT NULL, module_id TEXT NOT NULL, project_id TEXT NOT NULL,
            created_at TEXT NOT NULL, terminated_at TEXT, scope TEXT NOT NULL,
            doc_rel_path TEXT, runtime_cleanup_pending BOOL NOT NULL DEFAULT 0,
            runtime_namespace TEXT, output_identity TEXT,
            output_sequence INTEGER NOT NULL DEFAULT 0, last_output_at TEXT, agent TEXT
        );
        CREATE TABLE runs_status_events (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
            subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
            automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
            committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
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
            effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL, automation_attempt_id TEXT,
            request_id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, issue_id TEXT NOT NULL,
            scope TEXT NOT NULL, provider TEXT NOT NULL, target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL, policy_reference TEXT, state TEXT NOT NULL DEFAULT 'prepared',
            lease_owner TEXT, lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error_code TEXT, last_error_message TEXT, runtime_evidence TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_at TEXT
        );
        INSERT INTO worktracker_issue VALUES
            ('module-a','project-a','module',NULL),
            ('task-a','project-a','task','module-a'),
            ('task-b','project-a','task','module-a'),
            ('task-foreign','project-b','task',NULL);
    "#).await.unwrap();
    let services = RunsServices::new(database.clone());
    (directory, database, services)
}

async fn insert_run(
    database: &DatabaseConnection,
    id: &str,
    issue: &str,
    started: &str,
    ended: Option<&str>,
    status: &str,
    lifecycle: Option<&str>,
    lifecycle_at: Option<&str>,
    provider: Option<&str>,
    scope: &str,
) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO agent_runs
           (id, issue_id, agent, status, started_at, ended_at, provider_session_id,
            lifecycle_state, lifecycle_updated_at, scope)
           VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?)"#,
            [
                id.into(),
                issue.into(),
                status.into(),
                started.into(),
                ended.into(),
                provider.into(),
                lifecycle.into(),
                lifecycle_at.into(),
                scope.into(),
            ],
        ))
        .await
        .unwrap();
}

async fn event_count(database: &DatabaseConnection) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM runs_status_events".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "count")
        .unwrap()
}

fn ids(rows: &[AgentRunHolding]) -> Vec<&str> {
    rows.iter().map(|row| row.agent_run_id.as_str()).collect()
}

#[tokio::test]
async fn holdings_are_scoped_restart_safe_and_keep_old_active_runs() {
    let (_directory, database, services) = fixture().await;
    insert_run(
        &database,
        "old-active",
        "task-a",
        "2026-01-01T00:00:00+00:00",
        None,
        "running",
        Some("working"),
        Some("2026-01-01T01:00:00+00:00"),
        Some("provider-stable"),
        "task",
    )
    .await;
    insert_run(
        &database,
        "old-ended",
        "task-a",
        "2026-01-01T00:00:00+00:00",
        Some("2026-01-02T00:00:00+00:00"),
        "completed",
        Some("working"),
        Some("2026-01-01T01:00:00+00:00"),
        None,
        "task",
    )
    .await;
    insert_run(
        &database,
        "recent-ended",
        "task-a",
        "2026-08-01T00:00:00+00:00",
        Some("2026-08-02T00:00:00+00:00"),
        "completed",
        Some("working"),
        Some("2026-08-01T01:00:00+00:00"),
        None,
        "task",
    )
    .await;
    insert_run(
        &database,
        "lost",
        "task-a",
        "2026-08-03T00:00:00+00:00",
        Some("2026-08-03T01:00:00+00:00"),
        "lost",
        Some("working"),
        Some("2026-08-03T00:30:00+00:00"),
        None,
        "task",
    )
    .await;
    insert_run(
        &database,
        "task-b",
        "task-b",
        "2026-08-04T00:00:00+00:00",
        None,
        "running",
        Some("quiet"),
        Some("2026-08-04T01:00:00+00:00"),
        None,
        "task",
    )
    .await;
    insert_run(
        &database,
        "foreign",
        "task-foreign",
        "2026-08-04T00:00:00+00:00",
        None,
        "running",
        Some("working"),
        None,
        None,
        "task",
    )
    .await;
    insert_run(
        &database,
        "docchat",
        "task-a",
        "2026-08-04T00:00:00+00:00",
        None,
        "running",
        Some("working"),
        None,
        None,
        "docchat",
    )
    .await;

    let project = services
        .queries()
        .run_holdings_at("project-a", None, "2026-08-12T00:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        ids(&project),
        vec!["task-b", "lost", "recent-ended", "old-active"]
    );
    assert_eq!(
        project
            .iter()
            .find(|row| row.agent_run_id == "lost")
            .unwrap()
            .state,
        "lost"
    );
    assert_eq!(
        project
            .iter()
            .find(|row| row.agent_run_id == "recent-ended")
            .unwrap()
            .state,
        "exited"
    );
    assert_eq!(
        project
            .iter()
            .find(|row| row.agent_run_id == "old-active")
            .unwrap()
            .provider_session_id
            .as_deref(),
        Some("provider-stable")
    );
    let task = services
        .queries()
        .run_holdings_at("project-a", Some("task-a"), "2026-08-12T00:00:00Z")
        .await
        .unwrap();
    assert_eq!(ids(&task), vec!["lost", "recent-ended", "old-active"]);
    drop(services);
    let reopened = RunsServices::new(database.clone());
    assert_eq!(
        reopened
            .queries()
            .run_holdings_at("project-a", Some("task-a"), "2026-08-12T00:00:00Z")
            .await
            .unwrap(),
        task
    );
}

#[tokio::test]
async fn lifecycle_and_terminal_facts_are_ordered_idempotent_and_atomic() {
    let (_directory, database, services) = fixture().await;
    insert_run(
        &database,
        "run",
        "task-a",
        "2026-08-12T07:00:00+00:00",
        None,
        "running",
        None,
        None,
        None,
        "task",
    )
    .await;
    let first = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run".into(),
            kind: "turn_start".into(),
            occurred_at: "2026-08-12T03:00:00-05:00".into(),
            provider_session_id: Some("provider-first".into()),
        })
        .await
        .unwrap();
    assert!(first.applied);
    assert_eq!(first.occurred_at, "2026-08-12T08:00:00+00:00");
    assert_eq!(event_count(&database).await, 1);
    let duplicate = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run".into(),
            kind: "turn_start".into(),
            occurred_at: "2026-08-12T08:00:00Z".into(),
            provider_session_id: Some("provider-first".into()),
        })
        .await
        .unwrap();
    assert!(!duplicate.applied);
    assert_eq!(event_count(&database).await, 1);
    let older = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run".into(),
            kind: "idle".into(),
            occurred_at: "2026-08-12T07:59:59Z".into(),
            provider_session_id: Some("provider-second".into()),
        })
        .await
        .unwrap();
    assert!(!older.applied);
    let newer = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run".into(),
            kind: "awaiting_input".into(),
            occurred_at: "2026-08-12T09:00:00Z".into(),
            provider_session_id: Some("provider-second".into()),
        })
        .await
        .unwrap();
    assert!(newer.applied);
    let row = services
        .lifecycle()
        .runs()
        .find("run")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.provider_session_id.as_deref(), Some("provider-first"));
    assert_eq!(row.lifecycle_state.as_deref(), Some("needs_input"));
    services
        .lifecycle()
        .apply_terminal_fact(TerminalFact {
            agent_run_id: "run".into(),
            outcome: TerminalOutcome::Lost,
            occurred_at: "2026-08-12T10:00:00Z".into(),
            exit_code: None,
        })
        .await
        .unwrap();
    let late = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "run".into(),
            kind: "turn_start".into(),
            occurred_at: "2026-08-12T11:00:00Z".into(),
            provider_session_id: None,
        })
        .await
        .unwrap();
    assert!(!late.applied);
    assert_eq!(event_count(&database).await, 3);
    let holding = services
        .queries()
        .run_holdings_at("project-a", Some("task-a"), "2026-08-12T12:00:00Z")
        .await
        .unwrap();
    assert_eq!(holding[0].state, "lost");
    let exit_after_loss = services
        .lifecycle()
        .apply_terminal_fact(TerminalFact {
            agent_run_id: "run".into(),
            outcome: TerminalOutcome::Exited,
            occurred_at: "2026-08-12T12:00:00Z".into(),
            exit_code: Some(0),
        })
        .await
        .unwrap();
    assert!(!exit_after_loss.applied);
    assert_eq!(event_count(&database).await, 3);
    let unknown = services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "historical-missing".into(),
            kind: "idle".into(),
            occurred_at: "2026-08-12T12:00:00Z".into(),
            provider_session_id: None,
        })
        .await
        .unwrap();
    assert!(unknown.accepted && !unknown.known_run && !unknown.applied);
    assert_eq!(event_count(&database).await, 3);
}

#[tokio::test]
async fn failed_event_append_rolls_back_the_lifecycle_row() {
    let (_directory, database, services) = fixture().await;
    insert_run(
        &database,
        "rollback",
        "task-a",
        "2026-08-12T07:00:00Z",
        None,
        "running",
        None,
        None,
        None,
        "task",
    )
    .await;
    database
        .execute_unprepared("DROP TABLE runs_status_events")
        .await
        .unwrap();
    assert!(services
        .lifecycle()
        .apply_lifecycle_fact(LifecycleFact {
            agent_run_id: "rollback".into(),
            kind: "turn_start".into(),
            occurred_at: "2026-08-12T08:00:00Z".into(),
            provider_session_id: Some("provider".into()),
        })
        .await
        .is_err());
    let row = services
        .lifecycle()
        .runs()
        .find("rollback")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.lifecycle_state, None);
    assert_eq!(row.provider_session_id, None);
}

#[tokio::test]
async fn same_timestamp_lifecycle_facts_resolve_in_arrival_order() {
    let (_directory, database, services) = fixture().await;
    insert_run(
        &database,
        "same-second",
        "task-a",
        "2026-08-12T07:00:00Z",
        None,
        "running",
        None,
        None,
        None,
        "task",
    )
    .await;
    let apply = |kind: &'static str| {
        let services = services.clone();
        async move {
            services
                .lifecycle()
                .apply_lifecycle_fact(LifecycleFact {
                    agent_run_id: "same-second".into(),
                    kind: kind.into(),
                    occurred_at: "2026-08-12T08:00:00Z".into(),
                    provider_session_id: None,
                })
                .await
                .unwrap()
        }
    };
    assert!(apply("turn_start").await.applied);
    // The provider gives no sub-second ordering, so the second fact resolves
    // deterministically in arrival order rather than raising a conflict.
    let second = apply("awaiting_input").await;
    assert!(second.applied);
    assert_eq!(second.state.as_deref(), Some("needs_input"));
    // The exact duplicate stays a no-op.
    assert!(!apply("awaiting_input").await.applied);
    assert_eq!(event_count(&database).await, 2);
}

#[tokio::test]
async fn generated_graphql_contract_has_scoped_holdings_and_no_legacy_run_termination() {
    let sdl = ticketry_graphql_schema::generated_schema_sdl()
        .await
        .unwrap();
    assert!(sdl
        .contains("agent_run_holdings(project_id: String!, task_id: String): [AgentRunHolding!]!"));
    assert!(sdl.contains("ingest_agent_lifecycle("));
    assert!(!sdl.contains("terminate_current_agent_run"));
    assert!(sdl.contains("terminal_session_update(agent_run_id: String!, termination_request_id: String): AgentTerminalSessions!"));
}
