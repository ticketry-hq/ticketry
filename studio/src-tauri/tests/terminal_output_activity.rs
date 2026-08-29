use async_trait::async_trait;
use muxed_studio_lib::runs_persistence::{RunsServices, TerminalFact, TerminalOutcome};
use muxed_studio_lib::terminal::output_activity::{
    LiveOutputSweepRuntime, TerminalOutputActivityError, TerminalOutputActivityService,
    TerminalScreenCapture,
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

const PROJECT: &str = "11111111111111111111111111111111";
const PUBLIC_PROJECT: &str = "11111111-1111-1111-1111-111111111111";
const TASK: &str = "22222222222222222222222222222222";
const PUBLIC_TASK: &str = "22222222-2222-2222-2222-222222222222";
const MODULE: &str = "33333333333333333333333333333333";

struct UnusedCapture;

#[async_trait]
impl TerminalScreenCapture for UnusedCapture {
    async fn capture(&self, _: &str) -> Result<Vec<u8>, TerminalOutputActivityError> {
        panic!("record_captured tests do not invoke runtime capture")
    }
}

struct CountingCapture(AtomicUsize);

#[async_trait]
impl TerminalScreenCapture for CountingCapture {
    async fn capture(&self, _: &str) -> Result<Vec<u8>, TerminalOutputActivityError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(b"rendered screen".to_vec())
    }
}

struct OrderedCapture {
    calls: Mutex<Vec<String>>,
    sequence: AtomicUsize,
    fail: Option<String>,
}

#[async_trait]
impl TerminalScreenCapture for OrderedCapture {
    async fn capture(&self, agent_run_id: &str) -> Result<Vec<u8>, TerminalOutputActivityError> {
        self.calls.lock().unwrap().push(agent_run_id.to_owned());
        if self.fail.as_deref() == Some(agent_run_id) {
            return Err(sea_orm::DbErr::Custom("injected capture failure".to_owned()).into());
        }
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst);
        Ok(format!("{agent_run_id}:{sequence}").into_bytes())
    }
}

async fn fixture() -> (
    tempfile::TempDir,
    DatabaseConnection,
    TerminalOutputActivityService,
) {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    database
        .execute_unprepared(&format!(
            r#"
            CREATE TABLE worktracker_issue (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, module_id TEXT
            );
            CREATE TABLE agent_runs (
                id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT,
                model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,
                ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
                lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
                scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id TEXT PRIMARY KEY, tmux_session_name TEXT NOT NULL, task_id TEXT NOT NULL,
                module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
                terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,
                runtime_cleanup_pending INTEGER NOT NULL, runtime_namespace TEXT,
                output_identity TEXT, output_sequence INTEGER NOT NULL DEFAULT 0,
                last_output_at TEXT, agent TEXT
            );
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
                subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
                automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO worktracker_issue VALUES ('{MODULE}', '{PROJECT}', 'module', NULL);
            INSERT INTO worktracker_issue VALUES ('{TASK}', '{PROJECT}', 'task', '{MODULE}');
            INSERT INTO agent_runs
                (id, issue_id, agent, status, started_at, lifecycle_state, scope, launch_state, launch_model)
            VALUES
                ('run-a', '{TASK}', 'codex', 'running', '2026-08-20T10:00:00Z', 'working', 'task', 'Implement', 'gpt-5'),
                ('run-ended', '{TASK}', 'codex', 'completed', '2026-08-20T10:00:00Z', 'working', 'task', 'Implement', 'gpt-5');
            INSERT INTO agent_terminal_sessions VALUES
                ('run-a', 'pt-run-a', '{TASK}', '{MODULE}', '{PROJECT}', '2026-08-20T10:00:00Z', NULL, 'task', NULL, 0, 'test-runtime', NULL, 0, '2026-08-20T10:00:00Z', 'codex'),
                ('run-ended', 'pt-run-ended', '{TASK}', '{MODULE}', '{PROJECT}', '2026-08-20T10:00:00Z', NULL, 'task', NULL, 0, 'test-runtime', NULL, 0, '2026-08-20T10:00:00Z', 'codex');
            UPDATE agent_runs SET ended_at='2026-08-20T10:05:00Z' WHERE id='run-ended';
            "#
        ))
        .await
        .unwrap();
    let service = TerminalOutputActivityService::new(database.clone(), Arc::new(UnusedCapture));
    (directory, database, service)
}

async fn sequence(database: &DatabaseConnection, run_id: &str) -> i64 {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT output_sequence AS value FROM agent_terminal_sessions WHERE agent_run_id=?",
            [run_id.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "value")
        .unwrap()
}

async fn event_count(database: &DatabaseConnection) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS value FROM runs_status_events".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "value")
        .unwrap()
}

async fn event_work_item_id(database: &DatabaseConnection, run_id: &str) -> Option<String> {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT work_item_id FROM runs_status_events WHERE agent_run_id=? ORDER BY cursor DESC LIMIT 1",
            [run_id.into()],
        ))
        .await
        .unwrap()
        .and_then(|row| row.try_get("", "work_item_id").unwrap())
}

async fn event_project_id(database: &DatabaseConnection, run_id: &str) -> String {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT project_id FROM runs_status_events WHERE agent_run_id=? ORDER BY cursor DESC LIMIT 1",
            [run_id.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "project_id")
        .unwrap()
}

async fn insert_sweep_session(
    database: &DatabaseConnection,
    run_id: &str,
    created_at: &str,
    namespace: &str,
    ended_at: Option<&str>,
    terminated_at: Option<&str>,
    cleanup_pending: bool,
) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, lifecycle_state, scope) VALUES (?, ?, 'codex', 'running', ?, ?, 'working', 'task')",
            [run_id.into(), TASK.into(), created_at.into(), ended_at.into()],
        ))
        .await
        .unwrap();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, last_output_at, agent) VALUES (?, ?, ?, ?, ?, ?, ?, 'task', ?, ?, 0, ?, 'codex')",
            [
                run_id.into(),
                format!("pt-{run_id}").into(),
                TASK.into(),
                MODULE.into(),
                PROJECT.into(),
                created_at.into(),
                terminated_at.into(),
                cleanup_pending.into(),
                namespace.into(),
                created_at.into(),
            ],
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn sweep_filters_and_orders_live_sessions_and_isolates_capture_failures() {
    let (_directory, database, _) = fixture().await;
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    for (id, created, owned, ended, terminated, cleanup) in [
        (
            "run-failing",
            "2026-08-20T09:00:00Z",
            true,
            None,
            None,
            false,
        ),
        (
            "run-healthy",
            "2026-08-20T09:01:00Z",
            true,
            None,
            None,
            false,
        ),
        (
            "run-ended-sweep",
            "2026-08-20T09:02:00Z",
            true,
            Some("2026-08-20T09:03:00Z"),
            None,
            false,
        ),
        (
            "run-terminated-sweep",
            "2026-08-20T09:03:00Z",
            true,
            None,
            Some("2026-08-20T09:04:00Z"),
            false,
        ),
        (
            "run-cleanup",
            "2026-08-20T09:04:00Z",
            true,
            None,
            None,
            true,
        ),
        (
            "run-foreign",
            "2026-08-20T09:05:00Z",
            false,
            None,
            None,
            false,
        ),
    ] {
        insert_sweep_session(
            &database,
            id,
            created,
            if owned { &namespace } else { "other-runtime" },
            ended,
            terminated,
            cleanup,
        )
        .await;
    }
    let capture = Arc::new(OrderedCapture {
        calls: Mutex::new(Vec::new()),
        sequence: AtomicUsize::new(0),
        fail: Some("run-failing".to_owned()),
    });
    let service = TerminalOutputActivityService::new(database.clone(), capture.clone());

    assert_eq!(
        muxed_studio_lib::terminal::output_activity::observe_live_sessions(&service).await,
        1
    );
    assert_eq!(
        capture.calls.lock().unwrap().as_slice(),
        ["run-failing", "run-healthy"]
    );
    assert_eq!(sequence(&database, "run-healthy").await, 1);
    for id in [
        "run-ended-sweep",
        "run-terminated-sweep",
        "run-cleanup",
        "run-foreign",
    ] {
        assert_eq!(sequence(&database, id).await, 0, "{id} was not eligible");
    }
}

#[tokio::test]
async fn enumeration_failure_ends_only_that_pass() {
    let (_directory, database, _) = fixture().await;
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared("ALTER TABLE agent_terminal_sessions RENAME TO hidden_sessions")
        .await
        .unwrap();
    let capture = Arc::new(OrderedCapture {
        calls: Mutex::new(Vec::new()),
        sequence: AtomicUsize::new(0),
        fail: None,
    });
    let service = TerminalOutputActivityService::new(database.clone(), capture.clone());

    assert_eq!(
        muxed_studio_lib::terminal::output_activity::observe_live_sessions(&service).await,
        0
    );
    assert!(capture.calls.lock().unwrap().is_empty());

    database
        .execute_unprepared("ALTER TABLE hidden_sessions RENAME TO agent_terminal_sessions")
        .await
        .unwrap();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE agent_terminal_sessions SET runtime_namespace=? WHERE agent_run_id='run-a'",
            [namespace.into()],
        ))
        .await
        .unwrap();

    assert_eq!(
        muxed_studio_lib::terminal::output_activity::observe_live_sessions(&service).await,
        1
    );
    assert_eq!(capture.calls.lock().unwrap().as_slice(), ["run-a"]);
}

#[tokio::test]
async fn periodic_sweep_repeats_and_shutdown_cancels_future_passes() {
    let (_directory, database, _) = fixture().await;
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE agent_terminal_sessions SET runtime_namespace=? WHERE agent_run_id='run-a'",
            [namespace.into()],
        ))
        .await
        .unwrap();
    let capture = Arc::new(OrderedCapture {
        calls: Mutex::new(Vec::new()),
        sequence: AtomicUsize::new(0),
        fail: None,
    });
    let service = TerminalOutputActivityService::new(database.clone(), capture.clone());
    let runtime = LiveOutputSweepRuntime::start(service, Some(Duration::from_millis(10)));

    tokio::time::timeout(Duration::from_secs(1), async {
        while capture.calls.lock().unwrap().len() < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    runtime.shutdown().await;
    let stopped_at = capture.calls.lock().unwrap().len();
    tokio::time::sleep(Duration::from_millis(30)).await;

    assert!(stopped_at >= 2);
    assert_eq!(capture.calls.lock().unwrap().len(), stopped_at);
}

#[tokio::test]
async fn changed_output_advances_once_and_unchanged_output_extends_nothing() {
    let (_directory, database, service) = fixture().await;
    let first = service
        .record_captured("run-a", b"first screen", "2026-08-20T10:01:00Z")
        .await
        .unwrap();
    let duplicate = service
        .record_captured("run-a", b"first screen", "2026-08-20T10:02:00Z")
        .await
        .unwrap();
    let changed = service
        .record_captured("run-a", b"second screen", "2026-08-20T10:03:00Z")
        .await
        .unwrap();

    assert!(first.advanced);
    assert!(!duplicate.advanced);
    assert!(changed.advanced);
    assert_eq!(changed.output_sequence, 2);
    assert_eq!(
        changed.last_output_at.as_deref(),
        Some("2026-08-20T10:03:00+00:00")
    );
    assert_eq!(sequence(&database, "run-a").await, 2);
    assert_eq!(event_count(&database).await, 2);
}

#[tokio::test]
async fn status_events_store_database_uuid_spellings() {
    let (_directory, database, service) = fixture().await;
    database
        .execute_unprepared(&format!(
            "UPDATE agent_terminal_sessions SET task_id='{PUBLIC_TASK}', project_id='{PUBLIC_PROJECT}' WHERE agent_run_id='run-a'"
        ))
        .await
        .unwrap();

    service
        .record_captured("run-a", b"screen", "2026-08-20T10:01:00Z")
        .await
        .unwrap();

    assert_eq!(
        event_work_item_id(&database, "run-a").await.as_deref(),
        Some(TASK)
    );
    assert_eq!(event_project_id(&database, "run-a").await, PROJECT);
}

#[tokio::test]
async fn document_chat_advances_activity_without_project_status_publication() {
    let (_directory, database, service) = fixture().await;
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, lifecycle_state, scope) VALUES ('run-docchat', '{TASK}', 'codex', 'running', '2026-08-20T10:00:00Z', 'working', 'docchat');\n\
             INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope, doc_rel_path, runtime_cleanup_pending, output_sequence, last_output_at, agent) VALUES ('run-docchat', 'pt-run-docchat', '{TASK}', '{MODULE}', '{PROJECT}', '2026-08-20T10:00:00Z', 'docchat', 'notes.md', 0, 0, '2026-08-20T10:00:00Z', 'codex');"
        ))
        .await
        .unwrap();

    let observed = service
        .record_captured("run-docchat", b"chat output", "2026-08-20T10:01:00Z")
        .await
        .unwrap();

    assert!(observed.advanced);
    assert_eq!(observed.output_sequence, 1);
    assert_eq!(event_count(&database).await, 0);
}

#[tokio::test]
async fn shell_output_events_reference_the_module_instead_of_the_scratch_task() {
    let (_directory, database, service) = fixture().await;
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, status, started_at, lifecycle_state, scope) VALUES ('run-shell', '{MODULE}', 'running', '2026-08-20T10:00:00Z', 'starting', 'shell');\n\
             INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope, runtime_cleanup_pending, output_sequence, last_output_at) VALUES ('run-shell', 'pt-run-shell', '00000000000000000000000000000000', '{MODULE}', '{PROJECT}', '2026-08-20T10:00:00Z', 'shell', 0, 0, '2026-08-20T10:00:00Z');"
        ))
        .await
        .unwrap();

    let observed = service
        .record_captured("run-shell", b"shell output", "2026-08-20T10:01:00Z")
        .await
        .unwrap();

    assert!(observed.advanced);
    assert_eq!(
        event_work_item_id(&database, "run-shell").await.as_deref(),
        Some(MODULE)
    );
}

#[tokio::test]
async fn the_first_report_is_immediate_and_further_reports_are_coalesced_for_500ms() {
    let (_directory, database, _) = fixture().await;
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE agent_terminal_sessions SET runtime_namespace=? WHERE agent_run_id='run-a'",
            [namespace.into()],
        ))
        .await
        .unwrap();
    let capture = Arc::new(CountingCapture(AtomicUsize::new(0)));
    let service = TerminalOutputActivityService::new(database.clone(), capture.clone());

    let first = service.observe("run-a").await.unwrap();
    let coalesced = service.observe("run-a").await.unwrap();

    assert!(first.advanced);
    assert!(!coalesced.advanced);
    assert_eq!(capture.0.load(Ordering::SeqCst), 1);
    assert_eq!(sequence(&database, "run-a").await, 1);
}

#[tokio::test]
async fn concurrent_identical_reports_advance_once() {
    let (_directory, database, service) = fixture().await;
    let left = service.clone();
    let right = service.clone();
    let (left, right) = tokio::join!(
        left.record_captured("run-a", b"same screen", "2026-08-20T10:01:00Z"),
        right.record_captured("run-a", b"same screen", "2026-08-20T10:01:00Z")
    );

    assert!(left.is_ok(), "left report failed: {left:?}");
    assert!(right.is_ok(), "right report failed: {right:?}");
    assert_eq!(sequence(&database, "run-a").await, 1);
    assert_eq!(event_count(&database).await, 1);
}

#[tokio::test]
async fn concurrent_distinct_reports_preserve_a_strictly_increasing_sequence() {
    let (_directory, database, service) = fixture().await;
    let left = service.clone();
    let right = service.clone();
    let (left, right) = tokio::join!(
        left.record_captured("run-a", b"left screen", "2026-08-20T10:01:00Z"),
        right.record_captured("run-a", b"right screen", "2026-08-20T10:01:01Z")
    );

    assert!(left.is_ok(), "left report failed: {left:?}");
    assert!(right.is_ok(), "right report failed: {right:?}");
    assert_eq!(sequence(&database, "run-a").await, 2);
    assert_eq!(event_count(&database).await, 2);
}

#[tokio::test]
async fn status_append_failure_rolls_back_the_activity_axis() {
    let (_directory, database, service) = fixture().await;
    database
        .execute_unprepared(
            "CREATE TRIGGER reject_output_fact BEFORE INSERT ON runs_status_events \
             BEGIN SELECT RAISE(ABORT, 'status append failed'); END;",
        )
        .await
        .unwrap();

    assert!(service
        .record_captured("run-a", b"screen", "2026-08-20T10:01:00Z")
        .await
        .is_err());
    assert_eq!(sequence(&database, "run-a").await, 0);
    assert_eq!(event_count(&database).await, 0);
}

#[tokio::test]
async fn an_authoritative_terminal_outcome_rejects_late_output() {
    let (_directory, database, service) = fixture().await;
    let late = service
        .record_captured("run-ended", b"late", "2026-08-20T10:06:00Z")
        .await
        .unwrap();

    assert!(!late.advanced);
    assert_eq!(sequence(&database, "run-ended").await, 0);
    assert_eq!(event_count(&database).await, 0);
}

#[tokio::test]
async fn terminal_outcome_wins_a_concurrent_output_race_and_stays_final() {
    let (_directory, database, service) = fixture().await;
    let output = service.clone();
    let lifecycle = RunsServices::new(database.clone()).lifecycle().clone();
    let (observed, ended) = tokio::join!(
        output.record_captured("run-a", b"racing output", "2026-08-20T10:05:00Z"),
        lifecycle.apply_terminal_fact(TerminalFact {
            agent_run_id: "run-a".to_owned(),
            outcome: TerminalOutcome::Terminated,
            occurred_at: "2026-08-20T10:05:00Z".to_owned(),
            exit_code: None,
        })
    );
    assert!(observed.is_ok(), "output race failed: {observed:?}");
    assert!(ended.unwrap().applied);

    let late = service
        .record_captured("run-a", b"late output", "2026-08-20T10:06:00Z")
        .await
        .unwrap();
    let run = RunsServices::new(database)
        .queries()
        .run_holdings_at(PUBLIC_PROJECT, None, "2026-08-20T11:00:00Z")
        .await
        .unwrap()
        .into_iter()
        .find(|run| run.agent_run_id == "run-a")
        .unwrap();

    assert!(!late.advanced);
    assert_eq!(run.state, "exited");
    assert_eq!(run.effective_state, "exited");
}

#[tokio::test]
async fn event_and_snapshot_publish_the_same_run_projection() {
    let (_directory, database, service) = fixture().await;
    service
        .record_captured("run-a", b"screen", "2026-08-20T10:01:00Z")
        .await
        .unwrap();
    let payload: String = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT payload FROM runs_status_events".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "payload")
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(&payload).unwrap();
    let snapshot = RunsServices::new(database)
        .queries()
        .run_holdings_at(PUBLIC_PROJECT, None, "2026-08-20T10:01:00Z")
        .await
        .unwrap();

    let snapshot = snapshot
        .iter()
        .find(|run| run.agent_run_id == "run-a")
        .expect("the observed run remains in the snapshot");
    assert_eq!(event["run"], serde_json::to_value(snapshot).unwrap());
    assert_eq!(event["run"]["agent"], "codex");
    assert_eq!(event["run"]["launch_state"], "Implement");
    assert_eq!(event["run"]["launch_model"], "gpt-5");
    assert_eq!(event["run"]["output_sequence"], 1);
}

#[tokio::test]
async fn graphql_report_accepts_only_the_terminal_session_identity() {
    let foundation = Database::connect("sqlite::memory:").await.unwrap();
    let worktracker = Database::connect("sqlite::memory:").await.unwrap();
    let schema = muxed_studio_lib::query_root::foundation_schema(
        foundation,
        Some(worktracker),
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

    assert!(
        sdl.contains("terminal_output_observe(agent_run_id: String!): TerminalOutputObservation!")
    );
    for forbidden in ["screen:", "identity:", "output_sequence:", "observed_at:"] {
        assert!(!sdl.contains(&format!("terminal_output_observe({forbidden}")));
    }
}
