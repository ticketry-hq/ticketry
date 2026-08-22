use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
use sha2::{Digest, Sha256};

use super::TerminalPersistenceError;

pub const VERSION: i32 = 1;
pub const EMPTY_DJANGO_LEAF: &str = "0000_no_terminal_history";
pub const CURRENT_DJANGO_LEAF: &str = "0009_alter_terminallaunchrequest_agent";
pub const LEDGER_TABLE: &str = "ticketry_terminal_adoption";

pub const SESSION_COLUMNS: &[&str] = &[
    "agent_run_id",
    "tmux_session_name",
    "task_id",
    "module_id",
    "project_id",
    "created_at",
    "terminated_at",
    "scope",
    "doc_rel_path",
    "runtime_cleanup_pending",
    "runtime_namespace",
    "output_identity",
    "output_sequence",
    "last_output_at",
    "agent",
];
pub const LEASE_COLUMNS: &[&str] = &[
    "agent_run_id",
    "viewer_id",
    "transport",
    "generation",
    "acquired_at",
    "expires_at",
];
pub const LAUNCH_REQUEST_COLUMNS: &[&str] = &[
    "effect_id",
    "agent_run_id",
    "issue_id",
    "project_id",
    "module_id",
    "task_id",
    "scope",
    "doc_rel_path",
    "command",
    "working_directory",
    "environment",
    "columns",
    "rows",
    "created_at",
    "agent",
];
pub const LAUNCH_MATERIAL_COLUMNS: &[&str] = &[
    "effect_id",
    "agent_run_id",
    "schema_version",
    "request_id",
    "issue_id",
    "project_id",
    "module_id",
    "task_id",
    "provider",
    "model",
    "reasoning",
    "scope",
    "doc_rel_path",
    "prompt",
    "resume_from_agent_run_id",
    "required_skills",
    "working_directory_identity",
    "design_directory_identity",
    "initial_columns",
    "initial_rows",
    "created_at",
];
pub const CLEANUP_EFFECT_COLUMNS: &[&str] = &[
    "effect_id",
    "agent_run_id",
    "cause",
    "state",
    "lease_owner",
    "lease_expires_at",
    "attempt_count",
    "last_error_code",
    "last_error_message",
    "runtime_evidence",
    "created_at",
    "updated_at",
    "applied_at",
];

pub(crate) struct PreservationCheck<'a> {
    pub table: &'a str,
    pub columns: &'a [&'a str],
    pub row_count: u64,
    pub stable_digest: &'a str,
}

pub(crate) async fn install(
    database: &sea_orm::DatabaseConnection,
    source_leaf: &str,
    schema_fingerprint: &str,
    session_digest: &str,
    launch_request_digest: &str,
    preservation_checks: &[PreservationCheck<'_>],
) -> Result<(), TerminalPersistenceError> {
    let transaction = database.begin().await.map_err(storage)?;
    if source_leaf == EMPTY_DJANGO_LEAF {
        install_empty_tables(&transaction).await?;
    } else {
        rebuild_sessions(&transaction).await?;
        rebuild_leases(&transaction).await?;
        rebuild_launch_requests(&transaction).await?;
    }
    transaction
        .execute_unprepared(RUST_SCHEMA)
        .await
        .map_err(storage)?;
    verify_preserved_rows(&transaction, preservation_checks).await?;
    transaction.execute_raw(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO ticketry_terminal_adoption \
         (singleton, version, source_leaf, schema_fingerprint, session_digest, launch_request_digest) \
         VALUES (1, ?, ?, ?, ?, ?)",
        [VERSION.into(), source_leaf.into(), schema_fingerprint.into(), session_digest.into(), launch_request_digest.into()],
    )).await.map_err(storage)?;
    transaction.commit().await.map_err(storage)
}

async fn verify_preserved_rows(
    transaction: &sea_orm::DatabaseTransaction,
    checks: &[PreservationCheck<'_>],
) -> Result<(), TerminalPersistenceError> {
    for check in checks {
        let row = transaction
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("SELECT COUNT(*) AS count FROM {}", check.table),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| {
                TerminalPersistenceError::new(
                    super::TerminalPersistenceErrorCode::InvalidMetadata,
                    "Terminal row count is unavailable",
                )
            })?;
        let row_count = row.try_get::<i64>("", "count").map_err(storage)? as u64;
        let stable_digest = stable_digest(transaction, check.table, check.columns).await?;
        if row_count != check.row_count || stable_digest != check.stable_digest {
            return Err(TerminalPersistenceError::new(
                super::TerminalPersistenceErrorCode::InvalidMetadata,
                format!(
                    "{} history changed during staged Terminal adoption",
                    check.table
                ),
            ));
        }
    }
    Ok(())
}

async fn stable_digest(
    database: &impl ConnectionTrait,
    table: &str,
    columns: &[&str],
) -> Result<String, TerminalPersistenceError> {
    let expression = columns
        .iter()
        .map(|column| format!("\"{column}\""))
        .collect::<Vec<_>>()
        .join(",");
    let order = columns.first().copied().unwrap_or("rowid");
    let query =
        format!("SELECT json_array({expression}) AS row_data FROM {table} ORDER BY \"{order}\"");
    let mut hasher = Sha256::new();
    hasher.update(table.as_bytes());
    hasher.update(b"\n");
    for row in database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
        .await
        .map_err(storage)?
    {
        hasher.update(
            row.try_get::<String>("", "row_data")
                .map_err(storage)?
                .as_bytes(),
        );
        hasher.update(b"\n");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn install_empty_tables(
    transaction: &sea_orm::DatabaseTransaction,
) -> Result<(), TerminalPersistenceError> {
    transaction
        .execute_unprepared(SESSION_SCHEMA)
        .await
        .map_err(storage)?;
    transaction.execute_unprepared(
        "ALTER TABLE agent_terminal_sessions__rust RENAME TO agent_terminal_sessions; \
         CREATE INDEX agent_terminal_sessions_runtime_namespace_a928a9d9 ON agent_terminal_sessions(runtime_namespace); \
         CREATE INDEX idx_agent_terminal_sessions_task_created ON agent_terminal_sessions(task_id, terminated_at, created_at DESC);",
    ).await.map_err(storage)?;
    transaction
        .execute_unprepared(LEASE_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_unprepared(
            "ALTER TABLE agent_run_viewer_leases__rust RENAME TO agent_run_viewer_leases;",
        )
        .await
        .map_err(storage)?;
    transaction
        .execute_unprepared(LAUNCH_REQUEST_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_unprepared(
            "ALTER TABLE terminal_launch_requests__rust RENAME TO terminal_launch_requests;",
        )
        .await
        .map_err(storage)?;
    Ok(())
}

async fn rebuild_sessions(
    transaction: &sea_orm::DatabaseTransaction,
) -> Result<(), TerminalPersistenceError> {
    let installed = columns(transaction, "agent_terminal_sessions").await?;
    let value = |column: &str, fallback: &str| {
        if installed.contains(column) {
            format!("\"{column}\"")
        } else {
            fallback.to_owned()
        }
    };
    transaction
        .execute_unprepared(SESSION_SCHEMA)
        .await
        .map_err(storage)?;
    let select = [
        value("agent_run_id", "NULL"),
        value("tmux_session_name", "NULL"),
        value("task_id", "NULL"),
        value("module_id", "NULL"),
        value("project_id", "NULL"),
        value("created_at", "NULL"),
        value("terminated_at", "NULL"),
        value("scope", "'task'"),
        value("doc_rel_path", "NULL"),
        value("runtime_cleanup_pending", "0"),
        value("runtime_namespace", "NULL"),
        value("output_identity", "NULL"),
        value("output_sequence", "0"),
        if installed.contains("last_output_at") {
            "\"last_output_at\"".to_owned()
        } else {
            "CASE WHEN \"terminated_at\" IS NULL THEN \"created_at\" ELSE NULL END".to_owned()
        },
        value("agent", "NULL"),
    ]
    .join(", ");
    transaction.execute_unprepared(&format!(
        "INSERT INTO agent_terminal_sessions__rust SELECT {select} FROM agent_terminal_sessions;\n\
         DROP TABLE agent_terminal_sessions;\n\
         ALTER TABLE agent_terminal_sessions__rust RENAME TO agent_terminal_sessions;\n\
         CREATE INDEX agent_terminal_sessions_runtime_namespace_a928a9d9 ON agent_terminal_sessions(runtime_namespace);\n\
         CREATE INDEX idx_agent_terminal_sessions_task_created ON agent_terminal_sessions(task_id, terminated_at, created_at DESC);"
    )).await.map_err(storage)?;
    Ok(())
}

async fn rebuild_leases(
    transaction: &sea_orm::DatabaseTransaction,
) -> Result<(), TerminalPersistenceError> {
    let installed = columns(transaction, "agent_run_viewer_leases")
        .await
        .unwrap_or_default();
    transaction
        .execute_unprepared(LEASE_SCHEMA)
        .await
        .map_err(storage)?;
    if !installed.is_empty() {
        transaction.execute_unprepared(
            "INSERT INTO agent_run_viewer_leases__rust \
             SELECT agent_run_id, viewer_id, transport, substr('imported-' || agent_run_id, 1, 64), \
                    acquired_at, CASE WHEN expires_at > CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE expires_at END \
             FROM agent_run_viewer_leases; DROP TABLE agent_run_viewer_leases; \
             ALTER TABLE agent_run_viewer_leases__rust RENAME TO agent_run_viewer_leases;"
        ).await.map_err(storage)?;
    } else {
        transaction
            .execute_unprepared(
                "ALTER TABLE agent_run_viewer_leases__rust RENAME TO agent_run_viewer_leases;",
            )
            .await
            .map_err(storage)?;
    }
    Ok(())
}

async fn rebuild_launch_requests(
    transaction: &sea_orm::DatabaseTransaction,
) -> Result<(), TerminalPersistenceError> {
    let installed = columns(transaction, "terminal_launch_requests")
        .await
        .unwrap_or_default();
    transaction
        .execute_unprepared(LAUNCH_REQUEST_SCHEMA)
        .await
        .map_err(storage)?;
    if !installed.is_empty() {
        transaction.execute_unprepared(
            "INSERT INTO terminal_launch_requests__rust \
             (effect_id, agent_run_id, issue_id, project_id, module_id, task_id, scope, doc_rel_path, command, working_directory, environment, columns, rows, created_at, agent) \
             SELECT effect_id, agent_run_id, issue_id, project_id, module_id, task_id, scope, doc_rel_path, command, working_directory, environment, columns, rows, created_at, agent \
             FROM terminal_launch_requests; DROP TABLE terminal_launch_requests; \
             ALTER TABLE terminal_launch_requests__rust RENAME TO terminal_launch_requests;"
        ).await.map_err(storage)?;
    } else {
        transaction
            .execute_unprepared(
                "ALTER TABLE terminal_launch_requests__rust RENAME TO terminal_launch_requests;",
            )
            .await
            .map_err(storage)?;
    }
    Ok(())
}

pub(crate) async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, TerminalPersistenceError> {
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

const SESSION_SCHEMA: &str = r#"
CREATE TABLE agent_terminal_sessions__rust (
    agent_run_id varchar NOT NULL PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    tmux_session_name varchar NOT NULL,
    task_id varchar NOT NULL,
    module_id varchar NOT NULL,
    project_id varchar NOT NULL,
    created_at varchar NOT NULL,
    terminated_at varchar NULL,
    scope varchar NOT NULL DEFAULT 'task' CHECK (scope IN ('task','plan','instant','docchat','shell')),
    doc_rel_path varchar NULL,
    runtime_cleanup_pending bool NOT NULL DEFAULT 0,
    runtime_namespace varchar(64) NULL,
    output_identity varchar(64) NULL,
    output_sequence bigint NOT NULL DEFAULT 0 CHECK (output_sequence >= 0),
    last_output_at varchar NULL,
    agent varchar NULL,
    CHECK ((scope = 'docchat') = (doc_rel_path IS NOT NULL))
);
"#;

const LEASE_SCHEMA: &str = r#"
CREATE TABLE agent_run_viewer_leases__rust (
    agent_run_id varchar NOT NULL PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    viewer_id varchar(64) NOT NULL,
    transport varchar(16) NOT NULL CHECK (transport IN ('native','xterm')),
    generation varchar(64) NOT NULL,
    acquired_at datetime NOT NULL,
    expires_at datetime NOT NULL
);
"#;

const LAUNCH_REQUEST_SCHEMA: &str = r#"
CREATE TABLE terminal_launch_requests__rust (
    effect_id varchar(64) NOT NULL PRIMARY KEY,
    agent_run_id varchar(255) NOT NULL UNIQUE,
    issue_id varchar(64) NOT NULL,
    project_id varchar(64) NOT NULL,
    module_id varchar(64) NOT NULL,
    task_id varchar(64) NOT NULL,
    scope varchar(32) NOT NULL CHECK (scope IN ('task','plan','instant','docchat','shell')),
    doc_rel_path varchar NULL,
    command text NOT NULL,
    working_directory varchar NOT NULL,
    environment text NOT NULL CHECK (json_valid(environment) AND json_type(environment) = 'object'),
    columns integer NOT NULL CHECK (columns > 0),
    rows integer NOT NULL CHECK (rows > 0),
    created_at varchar NOT NULL,
    agent varchar(64) NULL,
    CHECK ((scope = 'docchat') = (doc_rel_path IS NOT NULL))
);
"#;

const RUST_SCHEMA: &str = r#"
CREATE TABLE terminal_launch_material (
    effect_id char(32) PRIMARY KEY REFERENCES runs_launch_effects(effect_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    agent_run_id varchar(255) NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    request_id varchar(255) NOT NULL UNIQUE,
    issue_id char(32) NOT NULL,
    project_id char(32) NOT NULL,
    module_id char(32) NOT NULL,
    task_id char(32) NOT NULL,
    provider varchar(64) NULL,
    model varchar(255) NULL,
    reasoning varchar(64) NULL,
    scope varchar(32) NOT NULL CHECK (scope IN ('task','plan','instant','docchat','shell')),
    doc_rel_path varchar NULL,
    prompt text NULL,
    resume_from_agent_run_id varchar(255) NULL REFERENCES agent_runs(id) DEFERRABLE INITIALLY DEFERRED,
    required_skills text NOT NULL DEFAULT '[]' CHECK (json_valid(required_skills) AND json_type(required_skills) = 'array'),
    working_directory_identity varchar(255) NOT NULL,
    design_directory_identity varchar(255) NULL,
    initial_columns integer NOT NULL DEFAULT 80 CHECK (initial_columns > 0),
    initial_rows integer NOT NULL DEFAULT 24 CHECK (initial_rows > 0),
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((scope = 'docchat') = (doc_rel_path IS NOT NULL))
);
CREATE INDEX idx_terminal_launch_material_scope ON terminal_launch_material(project_id, module_id, task_id, scope, created_at);
CREATE TABLE terminal_cleanup_effects (
    effect_id char(32) PRIMARY KEY,
    agent_run_id varchar(255) NOT NULL UNIQUE REFERENCES agent_terminal_sessions(agent_run_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    cause varchar(32) NOT NULL CHECK (cause IN ('explicit','launch_compensation','hosted_exit','owned_orphan','temporary_profile')),
    state varchar(32) NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','leased','applied','failed','conflict','cleanup_pending')),
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
CREATE INDEX idx_terminal_cleanup_effects_reconcile ON terminal_cleanup_effects(state, lease_expires_at, created_at, effect_id);
CREATE TABLE ticketry_terminal_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    schema_fingerprint char(64) NOT NULL,
    session_digest char(64) NOT NULL,
    launch_request_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

fn storage(source: sea_orm::DbErr) -> TerminalPersistenceError {
    TerminalPersistenceError::storage("Terminal schema operation failed", source)
}
