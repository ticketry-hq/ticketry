use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

use super::{RunsPersistenceError, RunsPersistenceErrorCode};

pub const VERSION: i32 = 1;
pub const CURRENT_DJANGO_LEAF: &str = "0013_agentrun_launch_configuration_snapshot";
pub const LEGACY_TERMINAL_DJANGO_LEAF: &str = "0015_agentrun_initial_prompt";
pub const MERGED_DJANGO_LEAF: &str = "0015_merge_20260819_1521";
pub const FINAL_DJANGO_LEAF: &str = "0017_agentrun_launch_unattended";

pub const AUTHORED_TABLES: &[&str] = &[
    "agent_runs",
    "automation_attempts",
    "runs_status_events",
    "runs_project_compaction_watermarks",
    "runs_launch_effects",
];

pub(crate) const AGENT_RUN_COLUMNS: &[&str] = &[
    "id",
    "issue_id",
    "ticket_seq",
    "agent",
    "status",
    "started_at",
    "ended_at",
    "exit_code",
    "error",
    "cwd",
    "provider_session_id",
    "lifecycle_state",
    "lifecycle_updated_at",
    "design_dir",
    "resumed_from",
    "scope",
    "launch_state",
    "launch_model",
    "initial_prompt",
    "launch_reasoning",
    "launch_unattended",
];

pub(crate) const ATTEMPT_BASE_COLUMNS: &[&str] = &[
    "id",
    "transition_id",
    "issue_id",
    "from_state_id",
    "to_state_id",
    "workflow_revision",
    "status",
    "agent",
    "agent_run_id",
    "error",
    "retry_of_id",
    "root_attempt_id",
    "created_at",
    "updated_at",
];

pub(crate) async fn install(
    database: &sea_orm::DatabaseConnection,
    bridge_from: Option<&str>,
    stable_digest: &str,
) -> Result<(), RunsPersistenceError> {
    let transaction = database.begin().await.map_err(storage)?;
    bridge(&transaction, bridge_from).await?;
    transaction
        .execute_unprepared(FOCUSED_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO ticketry_runs_adoption (singleton, version, source_leaf, stable_digest) VALUES (1, ?, ?, ?)",
            [
                VERSION.into(),
                bridge_from.unwrap_or(CURRENT_DJANGO_LEAF).into(),
                stable_digest.into(),
            ],
        ))
        .await
        .map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    Ok(())
}

async fn bridge(
    transaction: &sea_orm::DatabaseTransaction,
    source_leaf: Option<&str>,
) -> Result<(), RunsPersistenceError> {
    let Some(source_leaf) = source_leaf else {
        return Ok(());
    };
    if source_leaf == FINAL_DJANGO_LEAF {
        return Ok(());
    }
    if matches!(
        source_leaf,
        LEGACY_TERMINAL_DJANGO_LEAF | MERGED_DJANGO_LEAF
    ) {
        rebuild_premerge_agent_runs(transaction).await?;
        return Ok(());
    }
    let source_number = migration_number(source_leaf)?;
    if source_number < 9 {
        transaction
            .execute_unprepared(
                "ALTER TABLE automation_attempts ADD COLUMN error_details text NULL;\n\
                 ALTER TABLE automation_attempts ADD COLUMN retryable bool NOT NULL DEFAULT 1;",
            )
            .await
            .map_err(storage)?;
    }
    if source_number < 10 {
        transaction.execute_unprepared(
            "UPDATE automation_attempts SET retryable=1 WHERE status='failed' AND retryable=0 AND (error LIKE 'required_skill_unavailable:%' OR json_extract(error_details, '$.code')='required_skill_unavailable')",
        ).await.map_err(storage)?;
    }
    if source_number < 11 {
        transaction
            .execute_unprepared(
                "ALTER TABLE automation_attempts ADD COLUMN dismissed_at datetime NULL;\n\
                 UPDATE automation_attempts SET dismissed_at=CURRENT_TIMESTAMP WHERE status='failed' AND dismissed_at IS NULL;",
            )
            .await
            .map_err(storage)?;
    }
    rebuild_premerge_agent_runs(transaction).await?;
    for migration in DJANGO_MIGRATIONS.iter().skip(source_number as usize) {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO django_migrations (app, name, applied) VALUES ('runs', ?, CURRENT_TIMESTAMP)",
                [(*migration).into()],
            ))
            .await
            .map_err(storage)?;
    }
    for migration in [
        "0013_agentrun_optional_agent",
        "0014_agentrun_launch_metadata",
        MERGED_DJANGO_LEAF,
    ] {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO django_migrations (app, name, applied) VALUES ('runs', ?, CURRENT_TIMESTAMP)",
                [migration.into()],
            ))
            .await
            .map_err(storage)?;
    }
    Ok(())
}

async fn rebuild_premerge_agent_runs(
    transaction: &sea_orm::DatabaseTransaction,
) -> Result<(), RunsPersistenceError> {
    let installed = columns(transaction, "agent_runs").await?;
    let select = AGENT_RUN_COLUMNS
        .iter()
        .map(|column| {
            if installed.contains(*column) {
                format!("\"{column}\"")
            } else if *column == "launch_model" && installed.contains("model") {
                "\"model\"".to_owned()
            } else if *column == "launch_reasoning" && installed.contains("reasoning") {
                "\"reasoning\"".to_owned()
            } else if *column == "launch_unattended" {
                "0".to_owned()
            } else {
                "NULL".to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    transaction
        .execute_unprepared(AGENT_RUN_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs__rust SELECT {select} FROM agent_runs;\n\
             DROP TABLE agent_runs;\n\
             ALTER TABLE agent_runs__rust RENAME TO agent_runs;\n\
             CREATE INDEX agent_runs_issue_id_f02b0ea6 ON agent_runs(issue_id);\n\
             CREATE INDEX idx_agent_runs_issue_started ON agent_runs(issue_id, started_at DESC);"
        ))
        .await
        .map_err(storage)?;
    Ok(())
}

fn migration_number(leaf: &str) -> Result<i32, RunsPersistenceError> {
    leaf.get(..4)
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|value| (8..=13).contains(value))
        .ok_or_else(|| {
            RunsPersistenceError::new(
                RunsPersistenceErrorCode::IncompatibleSchema,
                format!("unknown Runs migration leaf '{leaf}'"),
            )
        })
}

pub(crate) async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, RunsPersistenceError> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .map_err(storage)?;
    rows.into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect()
}

pub(crate) const DJANGO_MIGRATIONS: [&str; 13] = [
    "0001_initial",
    "0002_agentrun_resumed_from",
    "0003_drop_orchestrator_tables",
    "0004_automationattempt",
    "0005_automationattempt_retry",
    "0006_agentrun_scope",
    "0007_backfill_terminal_lifecycle_state",
    "0008_agentrun_issue",
    "0009_automationattempt_launch_rejection",
    "0010_make_required_skill_failures_retryable",
    "0011_dismiss_historical_automation_failures",
    "0012_remove_legacy_agentrun_run_kind",
    "0013_agentrun_launch_configuration_snapshot",
];

const FOCUSED_SCHEMA: &str = r#"
CREATE TABLE ticketry_runs_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    stable_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE runs_status_events (
    cursor integer PRIMARY KEY AUTOINCREMENT,
    event_id char(32) NOT NULL UNIQUE,
    project_id char(32) NOT NULL,
    event_kind varchar(64) NOT NULL,
    payload_version integer NOT NULL CHECK (payload_version > 0),
    subject_kind varchar(64) NOT NULL,
    subject_id varchar(255) NOT NULL,
    agent_run_id varchar(255) NULL,
    automation_attempt_id char(32) NULL,
    work_item_id char(32) NULL,
    payload text NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
    committed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_runs_status_events_project_cursor
    ON runs_status_events(project_id, cursor);
-- Compaction asks one project for its oldest retained rows, so the age
-- protection is an indexed lookup rather than a scan of the global cursor space.
CREATE INDEX idx_runs_status_events_project_committed
    ON runs_status_events(project_id, committed_at);
CREATE INDEX idx_runs_status_events_subject
    ON runs_status_events(subject_kind, subject_id, cursor);
CREATE TRIGGER runs_status_events_immutable
    BEFORE UPDATE ON runs_status_events BEGIN
        SELECT RAISE(ABORT, 'status events are immutable');
    END;
CREATE TABLE runs_project_compaction_watermarks (
    project_id char(32) PRIMARY KEY,
    compacted_through_cursor integer NOT NULL CHECK (compacted_through_cursor >= 0),
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE runs_launch_effects (
    effect_id char(32) PRIMARY KEY,
    intent_version integer NOT NULL DEFAULT 1 CHECK (intent_version = 1),
    agent_run_id varchar(255) NOT NULL UNIQUE,
    automation_attempt_id char(32) NULL UNIQUE,
    request_id varchar(255) NOT NULL UNIQUE,
    project_id char(32) NOT NULL,
    issue_id char(32) NOT NULL,
    scope varchar(32) NOT NULL,
    provider varchar(64) NULL,
    target_kind varchar(32) NOT NULL,
    target_id varchar(255) NOT NULL,
    policy_reference varchar(255) NULL,
    state varchar(32) NOT NULL DEFAULT 'prepared'
        CHECK (state IN ('prepared', 'leased', 'applied', 'failed', 'cleanup_pending')),
    lease_owner varchar(255) NULL,
    lease_expires_at datetime NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code varchar(64) NULL,
    last_error_message text NULL,
    runtime_evidence text NULL CHECK (runtime_evidence IS NULL OR json_valid(runtime_evidence)),
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at datetime NULL,
    CHECK ((state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((state = 'applied') = (applied_at IS NOT NULL))
);
CREATE INDEX idx_runs_launch_effects_reconcile
    ON runs_launch_effects(state, lease_expires_at, created_at, effect_id);
CREATE TRIGGER runs_launch_effect_intent_immutable
    BEFORE UPDATE ON runs_launch_effects
    WHEN OLD.effect_id <> NEW.effect_id
      OR OLD.intent_version <> NEW.intent_version
      OR OLD.agent_run_id <> NEW.agent_run_id
      OR OLD.automation_attempt_id IS NOT NEW.automation_attempt_id
      OR OLD.request_id <> NEW.request_id
      OR OLD.project_id <> NEW.project_id
      OR OLD.issue_id <> NEW.issue_id
      OR OLD.scope <> NEW.scope
      OR OLD.provider IS NOT NEW.provider
      OR OLD.target_kind <> NEW.target_kind
      OR OLD.target_id <> NEW.target_id
      OR OLD.policy_reference IS NOT NEW.policy_reference
    BEGIN
        SELECT RAISE(ABORT, 'launch intent is immutable');
    END;
"#;

const AGENT_RUN_SCHEMA: &str = r#"
CREATE TABLE agent_runs__rust (
    id varchar NOT NULL PRIMARY KEY,
    issue_id char(32) NOT NULL REFERENCES worktracker_issue(id) DEFERRABLE INITIALLY DEFERRED,
    ticket_seq integer NULL,
    agent varchar NULL,
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
    launch_model varchar NULL,
    initial_prompt text NULL,
    launch_reasoning varchar NULL,
    launch_unattended bool NOT NULL DEFAULT 0
);
"#;

fn storage(source: sea_orm::DbErr) -> RunsPersistenceError {
    RunsPersistenceError::storage("Runs schema operation failed", source)
}
