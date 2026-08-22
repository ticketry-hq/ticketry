use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

use super::{ExecutionPersistenceError, ExecutionPersistenceErrorCode};

pub const VERSION: i32 = 1;
pub const CURRENT_DJANGO_LEAF: &str = "0007_graph_run_launch_configuration";
pub const DJANGO_MIGRATIONS: [&str; 7] = [
    "0001_initial",
    "0002_graphrun",
    "0003_nullable_agent_override",
    "0004_remove_enginerun_phase",
    "0005_launchedtask_delete_enginerun",
    "0006_graphrun_execution_mode",
    CURRENT_DJANGO_LEAF,
];

pub const GRAPH_RUN_COLUMNS: &[&str] = &[
    "root_id",
    "project_id",
    "module_id",
    "agent",
    "launch_configuration",
    "execution_mode",
    "created_at",
    "updated_at",
];
pub const LAUNCH_LEDGER_COLUMNS: &[&str] = &[
    "task_id",
    "root_id",
    "claim_id",
    "agent_run_id",
    "launch_effect_id",
    "launch_generation",
    "launched_at",
];
pub const POLICY_EFFECT_COLUMNS: &[&str] = &[
    "decision_id",
    "caller_scope",
    "idempotency_key",
    "result",
    "created_at",
    "updated_at",
];

pub(crate) async fn install(
    database: &sea_orm::DatabaseConnection,
    source_leaf: &str,
    stable_digest: &str,
) -> Result<(), ExecutionPersistenceError> {
    let transaction = database.begin().await.map_err(storage)?;
    bridge(&transaction, source_leaf).await?;
    transaction
        .execute_unprepared(ADOPTION_LEDGER)
        .await
        .map_err(storage)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO ticketry_execution_adoption (singleton, version, source_leaf, stable_digest) VALUES (1, ?, ?, ?)",
            [VERSION.into(), source_leaf.into(), stable_digest.into()],
        ))
        .await
        .map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    Ok(())
}

async fn bridge(
    transaction: &sea_orm::DatabaseTransaction,
    source_leaf: &str,
) -> Result<(), ExecutionPersistenceError> {
    let source = migration_number(source_leaf)?;
    if source < 2 {
        transaction
            .execute_unprepared(GRAPH_RUN_TABLE)
            .await
            .map_err(storage)?;
    }
    if source < 5 {
        transaction
            .execute_unprepared(LAUNCH_LEDGER_TABLE)
            .await
            .map_err(storage)?;
        transaction
            .execute_unprepared("DROP TABLE engine_runs")
            .await
            .map_err(storage)?;
    }
    if source < 6 {
        transaction
            .execute_unprepared(
                "ALTER TABLE graph_runs ADD COLUMN execution_mode varchar(16) NOT NULL DEFAULT 'parallel'",
            )
            .await
            .map_err(storage)?;
    }
    if source < 7 {
        transaction
            .execute_unprepared(
                "ALTER TABLE graph_runs ADD COLUMN launch_configuration text NULL CHECK (json_valid(launch_configuration) OR launch_configuration IS NULL)",
            )
            .await
            .map_err(storage)?;
        transaction
            .execute_unprepared(POLICY_EFFECT_TABLE)
            .await
            .map_err(storage)?;
    }
    let effects_ready = table_exists(transaction, "runs_launch_effects").await?;
    let claims = row_count(transaction, "launched_tasks").await?;
    if claims > 0 && !effects_ready {
        return Err(incompatible(
            "campaign claim adoption requires the adopted Runs Launch Effect table",
        ));
    }
    if effects_ready {
        transaction
            .execute_unprepared(ADOPT_LAUNCH_EFFECTS)
            .await
            .map_err(storage)?;
    }
    transaction
        .execute_unprepared(if effects_ready {
            CRASH_SAFE_LAUNCH_LEDGER
        } else {
            CRASH_SAFE_EMPTY_LAUNCH_LEDGER
        })
        .await
        .map_err(storage)?;
    for migration in DJANGO_MIGRATIONS.iter().skip(source as usize) {
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO django_migrations (app, name, applied) VALUES ('execution', ?, CURRENT_TIMESTAMP)",
                [(*migration).into()],
            ))
            .await
            .map_err(storage)?;
    }
    Ok(())
}

async fn table_exists(
    transaction: &sea_orm::DatabaseTransaction,
    table: &str,
) -> Result<bool, ExecutionPersistenceError> {
    let row = transaction
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .map_err(storage)?
        .expect("SQLite count returns one row");
    Ok(row.try_get::<i64>("", "count").map_err(storage)? == 1)
}

async fn row_count(
    transaction: &sea_orm::DatabaseTransaction,
    table: &str,
) -> Result<i64, ExecutionPersistenceError> {
    let row = transaction
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .map_err(storage)?
        .expect("SQLite count returns one row");
    row.try_get("", "count").map_err(storage)
}

fn migration_number(leaf: &str) -> Result<usize, ExecutionPersistenceError> {
    leaf.get(..4)
        .and_then(|number| number.parse::<usize>().ok())
        .filter(|number| (1..=DJANGO_MIGRATIONS.len()).contains(number))
        .ok_or_else(|| incompatible(format!("unknown execution migration leaf '{leaf}'")))
}

pub(crate) async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, ExecutionPersistenceError> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .map_err(storage)?
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect()
}

const GRAPH_RUN_TABLE: &str = r#"
CREATE TABLE graph_runs (
    root_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
    project_id char(32) NOT NULL REFERENCES worktracker_project(id) ON DELETE CASCADE,
    module_id char(32) NULL REFERENCES worktracker_issue(id) ON DELETE SET NULL,
    agent varchar(255) NULL,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL
);
"#;

const LAUNCH_LEDGER_TABLE: &str = r#"
CREATE TABLE launched_tasks (
    task_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
    root_id char(32) NOT NULL REFERENCES worktracker_issue(id) ON DELETE CASCADE,
    claim_id char(32) NOT NULL UNIQUE,
    agent_run_id varchar(255) NOT NULL REFERENCES agent_runs(id),
    launch_effect_id char(32) NOT NULL UNIQUE REFERENCES runs_launch_effects(effect_id),
    launch_generation integer NOT NULL CHECK (launch_generation > 0),
    launched_at datetime NOT NULL
);
CREATE INDEX launched_tasks_root_id_8d9455d7 ON launched_tasks(root_id);
CREATE INDEX launched_tasks_agent_run_id_899 ON launched_tasks(agent_run_id);
"#;

const ADOPT_LAUNCH_EFFECTS: &str = r#"
INSERT INTO runs_launch_effects (
    effect_id, agent_run_id, request_id, project_id, issue_id, scope, provider,
    target_kind, target_id, policy_reference, state, runtime_evidence,
    created_at, updated_at, applied_at
)
SELECT
    'e' || substr(claim.task_id, 2, 15) || substr(claim.root_id, 17, 16),
    claim.agent_run_id,
    'graph-adopted:' || claim.task_id,
    graph.project_id,
    claim.task_id,
    COALESCE(run.scope, 'task'),
    COALESCE(run.agent, graph.agent, 'unknown'),
    'automation',
    claim.task_id,
    NULL,
    'applied',
    json_object('adopted', true, 'campaignClaim', claim.task_id),
    claim.launched_at,
    claim.launched_at,
    claim.launched_at
FROM launched_tasks claim
JOIN graph_runs graph ON graph.root_id = claim.root_id
JOIN agent_runs run ON run.id = claim.agent_run_id
WHERE NOT EXISTS (
    SELECT 1 FROM runs_launch_effects effect WHERE effect.agent_run_id = claim.agent_run_id
);
"#;

const CRASH_SAFE_LAUNCH_LEDGER: &str = r#"
ALTER TABLE launched_tasks RENAME TO launched_tasks_pre_crash_safe;
CREATE TABLE launched_tasks (
    task_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
    root_id char(32) NOT NULL REFERENCES graph_runs(root_id) ON DELETE CASCADE,
    claim_id char(32) NOT NULL UNIQUE,
    agent_run_id varchar(255) NOT NULL REFERENCES agent_runs(id),
    launch_effect_id char(32) NOT NULL UNIQUE REFERENCES runs_launch_effects(effect_id),
    launch_generation integer NOT NULL CHECK (launch_generation > 0),
    launched_at datetime NOT NULL
);
INSERT INTO launched_tasks (
    task_id, root_id, claim_id, agent_run_id, launch_effect_id,
    launch_generation, launched_at
)
SELECT
    claim.task_id,
    claim.root_id,
    'c' || substr(claim.task_id, 2, 15) || substr(claim.root_id, 17, 16),
    claim.agent_run_id,
    effect.effect_id,
    1,
    claim.launched_at
FROM launched_tasks_pre_crash_safe claim
JOIN runs_launch_effects effect ON effect.agent_run_id = claim.agent_run_id;
DROP TABLE launched_tasks_pre_crash_safe;
CREATE INDEX launched_tasks_root_id_8d9455d7 ON launched_tasks(root_id);
CREATE INDEX launched_tasks_agent_run_id_899 ON launched_tasks(agent_run_id);
"#;

const CRASH_SAFE_EMPTY_LAUNCH_LEDGER: &str = r#"
ALTER TABLE launched_tasks RENAME TO launched_tasks_pre_crash_safe;
CREATE TABLE launched_tasks (
    task_id char(32) PRIMARY KEY REFERENCES worktracker_issue(id) ON DELETE CASCADE,
    root_id char(32) NOT NULL REFERENCES graph_runs(root_id) ON DELETE CASCADE,
    claim_id char(32) NOT NULL UNIQUE,
    agent_run_id varchar(255) NOT NULL REFERENCES agent_runs(id),
    launch_effect_id char(32) NOT NULL UNIQUE REFERENCES runs_launch_effects(effect_id),
    launch_generation integer NOT NULL CHECK (launch_generation > 0),
    launched_at datetime NOT NULL
);
DROP TABLE launched_tasks_pre_crash_safe;
CREATE INDEX launched_tasks_root_id_8d9455d7 ON launched_tasks(root_id);
CREATE INDEX launched_tasks_agent_run_id_899 ON launched_tasks(agent_run_id);
"#;

const POLICY_EFFECT_TABLE: &str = r#"
CREATE TABLE launch_policy_effects (
    decision_id varchar(32) PRIMARY KEY,
    caller_scope varchar(32) NOT NULL,
    idempotency_key varchar(255) NOT NULL,
    result text NULL CHECK (json_valid(result) OR result IS NULL),
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    CONSTRAINT uniq_launch_policy_effect_identity UNIQUE (caller_scope, idempotency_key)
);
"#;

const ADOPTION_LEDGER: &str = r#"
CREATE TABLE ticketry_execution_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    stable_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

fn storage(source: sea_orm::DbErr) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(
        ExecutionPersistenceErrorCode::AdoptionUnavailable,
        format!("Execution schema operation failed: {source}"),
    )
}

fn incompatible(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::IncompatibleSchema, message)
}
