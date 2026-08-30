use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

use super::{adopt, SourceClassification, VERSION};

const LEGACY_RUST_SCHEMA: &str = r#"
CREATE TABLE worktracker_issue (id varchar PRIMARY KEY);
INSERT INTO worktracker_issue VALUES ('issue-1');

CREATE TABLE agent_runs (
    id varchar PRIMARY KEY,
    issue_id varchar NOT NULL,
    ticket_seq integer NULL,
    agent varchar NULL,
    model varchar NULL,
    reasoning varchar NULL,
    status varchar NOT NULL,
    started_at varchar NOT NULL,
    ended_at varchar NULL,
    exit_code integer NULL,
    error varchar NULL,
    cwd varchar NULL,
    provider_session_id varchar NULL,
    lifecycle_state varchar NULL,
    lifecycle_updated_at varchar NULL,
    design_dir varchar NULL,
    resumed_from varchar NULL,
    scope varchar NOT NULL,
    launch_state varchar NULL,
    launch_model varchar NULL
);
INSERT INTO agent_runs (
    id, issue_id, ticket_seq, agent, model, reasoning, status, started_at,
    scope, launch_state, launch_model
) VALUES (
    'run-1', 'issue-1', 17, 'codex', 'legacy-model', 'high', 'completed',
    '2026-08-30T00:00:00Z', 'task', 'Implement', 'launch-model'
);

CREATE TABLE automation_attempts (
    id char(32) PRIMARY KEY,
    transition_id char(32) NOT NULL,
    issue_id char(32) NOT NULL,
    from_state_id char(32) NOT NULL,
    to_state_id char(32) NOT NULL,
    workflow_revision integer NOT NULL,
    status varchar NOT NULL,
    agent varchar NULL,
    agent_run_id varchar NULL,
    error text NULL,
    retry_of_id char(32) NULL,
    root_attempt_id char(32) NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    error_details text NULL,
    retryable bool NOT NULL DEFAULT 1,
    dismissed_at datetime NULL
);
CREATE TABLE runs_status_events (id integer);
CREATE TABLE runs_project_compaction_watermarks (id integer);
CREATE TABLE runs_launch_effects (id integer);

CREATE TABLE ticketry_runs_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    stable_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO ticketry_runs_adoption
    (singleton, version, source_leaf, stable_digest)
VALUES (1, 1, '0015_merge_20260819_1521', 'legacy-digest');
"#;

#[tokio::test]
async fn upgrades_the_original_rust_owned_agent_run_schema_without_losing_history() {
    let directory = tempfile::tempdir().expect("create test data directory");
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open test database");
    database
        .execute_unprepared(LEGACY_RUST_SCHEMA)
        .await
        .expect("install the original Rust-owned schema");
    database.close().await.expect("close test database");

    let first = adopt(directory.path())
        .await
        .expect("upgrade the original Rust-owned schema");
    assert_eq!(first.source, SourceClassification::RustOwnedV1);

    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("reopen upgraded database");
    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version, source_leaf FROM ticketry_runs_adoption WHERE singleton=1".to_owned(),
        ))
        .await
        .expect("read upgraded ledger")
        .expect("upgraded ledger row");
    assert_eq!(ledger.try_get::<i32>("", "version").unwrap(), VERSION);
    assert_eq!(
        ledger.try_get::<String>("", "source_leaf").unwrap(),
        "0015_merge_20260819_1521"
    );
    let run = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT launch_model, launch_reasoning, initial_prompt, launch_unattended \
             FROM agent_runs WHERE id='run-1'"
                .to_owned(),
        ))
        .await
        .expect("read upgraded run")
        .expect("upgraded run row");
    assert_eq!(
        run.try_get::<String>("", "launch_model").unwrap(),
        "launch-model"
    );
    assert_eq!(
        run.try_get::<String>("", "launch_reasoning").unwrap(),
        "high"
    );
    assert_eq!(
        run.try_get::<Option<String>>("", "initial_prompt").unwrap(),
        None
    );
    assert!(!run.try_get::<bool>("", "launch_unattended").unwrap());
    let columns = super::schema::columns(&database, "agent_runs")
        .await
        .expect("read upgraded columns");
    assert!(!columns.contains("model"));
    assert!(!columns.contains("reasoning"));
    database.close().await.expect("close upgraded database");

    let second = adopt(directory.path())
        .await
        .expect("reopen the upgraded schema");
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(first.stable_digest, second.stable_digest);
}
