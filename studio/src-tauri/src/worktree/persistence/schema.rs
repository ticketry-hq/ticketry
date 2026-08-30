use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

use super::WorktreePersistenceError;

/// Version of the Rust-owned Worktree ownership ledger.
pub const VERSION: i32 = 1;

/// The only Django migration history this adoption bridges from.
pub const CURRENT_DJANGO_LEAF: &str = "0001_initial";

/// Every Django `worktrees` migration, in applied order.
pub(crate) const DJANGO_MIGRATIONS: [&str; 1] = [CURRENT_DJANGO_LEAF];

/// The adopted table, at the column shape both Django and Rust observe. The
/// Worktree schema has never needed a bridge: the initial migration is still
/// the leaf, so adoption only installs the ownership ledger beside it.
pub const ADOPTED_TABLE: &str = "worktrees";

/// The ownership ledger this slice authors. It has never had a Django writer.
pub const LEDGER_TABLE: &str = "ticketry_worktrees_adoption";

pub(crate) const LEGACY_WORKTREE_COLUMNS: &[&str] = &[
    "id",
    "task_id",
    "workspace_slug",
    "project_id",
    "module_id",
    "ticket_seq",
    "repo_root",
    "path",
    "branch",
    "base_branch",
    "base_commit",
    "status",
    "ephemeral",
    "created_at",
    "updated_at",
];

pub(crate) const WORKTREE_COLUMNS: &[&str] = &[
    "id",
    "task_id",
    "workspace_slug",
    "project_id",
    "module_id",
    "ticket_seq",
    "repo_root",
    "path",
    "branch",
    "base_branch",
    "base_commit",
    "status",
    "ephemeral",
    "created_at",
    "updated_at",
    "pull_request_url",
];

/// Persisted lifecycle states. Successful integration and discard delete the
/// row instead of recording a terminal state.
pub(crate) const LIFECYCLE_STATES: &[&str] = &["active", "conflict"];

pub(crate) async fn install(
    database: &sea_orm::DatabaseConnection,
    source_leaf: &str,
    stable_digest: &str,
) -> Result<(), WorktreePersistenceError> {
    let transaction = database.begin().await.map_err(storage)?;
    transaction
        .execute_unprepared(LEDGER_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO ticketry_worktrees_adoption (singleton, version, source_leaf, stable_digest) VALUES (1, ?, ?, ?)",
            [VERSION.into(), source_leaf.into(), stable_digest.into()],
        ))
        .await
        .map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    Ok(())
}

pub(crate) async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, WorktreePersistenceError> {
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

const LEDGER_SCHEMA: &str = r#"
CREATE TABLE ticketry_worktrees_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    stable_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

fn storage(source: sea_orm::DbErr) -> WorktreePersistenceError {
    WorktreePersistenceError::storage("Worktree schema operation failed", source)
}
