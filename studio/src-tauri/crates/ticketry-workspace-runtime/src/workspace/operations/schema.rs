//! The Rust-authored Workspace Operation journal schema.
//!
//! This table has never had a Django writer and never will. Installation is
//! deterministic and repeatable so a restart, an adoption pass, and a fresh
//! database all converge on the same shape: the DDL is idempotent and the
//! recorded version is the checked contract the ownership manifest asserts
//! against.

use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

use super::{WorkspaceOperationError, WorkspaceOperationErrorCode};

/// Version of the authored journal schema.
pub const VERSION: i32 = 1;

/// The tables this capability authors outright.
pub const AUTHORED_TABLES: &[&str] = &[
    "workspace_operations",
    "ticketry_workspace_operations_schema",
];

pub const OPERATION_COLUMNS: &[&str] = &[
    "operation_id",
    "kind",
    "intent_version",
    "resource_kind",
    "resource_key",
    "intent",
    "intent_fingerprint",
    "state",
    "lease_owner",
    "lease_expires_at",
    "attempt_count",
    "last_error_code",
    "last_error_message",
    "evidence",
    "result_summary",
    "created_at",
    "updated_at",
    "settled_at",
];

/// Install the journal. Running this twice against the same database is a
/// no-op, and running it against a database that already carries a different
/// version is a typed refusal rather than a silent migration.
pub async fn install(database: &DatabaseConnection) -> Result<(), WorkspaceOperationError> {
    let transaction = database.begin().await.map_err(storage)?;
    transaction
        .execute_unprepared(FOCUSED_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT OR IGNORE INTO ticketry_workspace_operations_schema (singleton, version) VALUES (1, ?)",
            [VERSION.into()],
        ))
        .await
        .map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    verify(database).await
}

/// Prove the installed journal matches the checked contract. Startup calls
/// this before reconciliation runs, so an unknown shape stops the capability
/// instead of being reconciled against.
pub async fn verify(database: &DatabaseConnection) -> Result<(), WorkspaceOperationError> {
    let version = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version FROM ticketry_workspace_operations_schema WHERE singleton = 1",
        ))
        .await
        .map_err(storage)?
        .map(|row| row.try_get::<i32>("", "version"))
        .transpose()
        .map_err(storage)?;
    if version != Some(VERSION) {
        return Err(WorkspaceOperationError::new(
            WorkspaceOperationErrorCode::Storage,
            "The Workspace Operation journal schema version is not the supported version.",
        ));
    }
    let installed = columns(database, "workspace_operations").await?;
    let expected = OPERATION_COLUMNS
        .iter()
        .copied()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    if installed != expected {
        return Err(WorkspaceOperationError::new(
            WorkspaceOperationErrorCode::Storage,
            "The Workspace Operation journal columns do not match the checked contract.",
        ));
    }
    Ok(())
}

pub async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, WorkspaceOperationError> {
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

/// The states an operation can hold, and what each one means:
///
/// * `prepared` — durable and owed an effect. A retryable failure returns here
///   under the same identity rather than minting a second operation.
/// * `leased` — one worker holds it. The lease is concurrency control only;
///   its expiry makes the row eligible again, never permission to act.
/// * `applied` — the effect is durable and its result is replayable.
/// * `conflicted` — external state contradicts the intent. Never retried,
///   because retrying could only duplicate or destroy the conflicting thing.
/// * `failed` — settled, non-retryable, with its evidence retained.
/// * `cleanup_pending` — failed while an external effect might survive.
///   Reconciliation keeps probing until absence is proven.
const FOCUSED_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS ticketry_workspace_operations_schema (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    installed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS workspace_operations (
    operation_id char(32) PRIMARY KEY,
    kind varchar(64) NOT NULL,
    intent_version integer NOT NULL CHECK (intent_version > 0),
    resource_kind varchar(64) NOT NULL,
    resource_key varchar(500) NOT NULL,
    intent text NOT NULL CHECK (json_valid(intent) AND json_type(intent) = 'object'),
    intent_fingerprint char(64) NOT NULL,
    state varchar(32) NOT NULL DEFAULT 'prepared'
        CHECK (state IN ('prepared', 'leased', 'applied', 'conflicted', 'failed', 'cleanup_pending')),
    lease_owner varchar(255) NULL,
    lease_expires_at datetime NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code varchar(64) NULL,
    last_error_message text NULL,
    evidence text NULL CHECK (evidence IS NULL OR json_valid(evidence)),
    result_summary text NULL CHECK (result_summary IS NULL OR json_valid(result_summary)),
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at datetime NULL,
    CHECK ((state = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((state IN ('applied', 'conflicted', 'failed')) = (settled_at IS NOT NULL))
);
-- The reconciliation backlog is a state-ordered scan bounded by one batch.
CREATE INDEX IF NOT EXISTS idx_workspace_operations_backlog
    ON workspace_operations(state, lease_expires_at, created_at, operation_id);
-- An ambiguous resource is isolated by its subject, so the lookup that decides
-- whether a resource is already contended must not scan the whole journal.
CREATE INDEX IF NOT EXISTS idx_workspace_operations_resource
    ON workspace_operations(resource_kind, resource_key, state);
CREATE TRIGGER IF NOT EXISTS workspace_operation_intent_immutable
    BEFORE UPDATE ON workspace_operations
    WHEN OLD.operation_id <> NEW.operation_id
      OR OLD.kind <> NEW.kind
      OR OLD.intent_version <> NEW.intent_version
      OR OLD.resource_kind <> NEW.resource_kind
      OR OLD.resource_key <> NEW.resource_key
      OR OLD.intent <> NEW.intent
      OR OLD.intent_fingerprint <> NEW.intent_fingerprint
      OR OLD.created_at <> NEW.created_at
    BEGIN
        SELECT RAISE(ABORT, 'workspace operation intent is immutable');
    END;
"#;

fn storage(source: sea_orm::DbErr) -> WorkspaceOperationError {
    WorkspaceOperationError::storage("Workspace Operation schema operation failed", source)
}
