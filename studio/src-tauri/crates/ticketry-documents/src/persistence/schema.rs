//! The adopted `design_documents` shape and the one bridge this slice needs.
//!
//! Django's Documents app has a single migration leaf, so the bridge is not a
//! catch-up across generations: it adds the nullable `content_digest` column
//! the save/reconcile path needs and installs the Rust ownership ledger. No
//! existing column is rewritten, reordered, or dropped.

use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};

use super::DocumentsPersistenceError;

pub const VERSION: i32 = 1;
pub const CURRENT_DJANGO_LEAF: &str = "0001_initial";

/// The Rust ownership ledger installed beside the adopted table.
pub const LEDGER_TABLE: &str = "ticketry_documents_adoption";

/// Every table whose writer becomes Rust once Documents is adopted.
pub const AUTHORED_TABLES: &[&str] = &["design_documents"];

/// The columns Django created, in migration order. Their values are preserved
/// byte for byte and they are the columns the stable digest covers.
pub const DJANGO_COLUMNS: &[&str] = &[
    "id",
    "module_id",
    "task_id",
    "scope",
    "root_dir",
    "rel_path",
    "discovered_by_run_id",
    "created_at",
    "updated_at",
];

/// The one column this slice adds. Nullable, server-owned, and never copied
/// from a file body.
pub const ADOPTED_COLUMN: &str = "content_digest";

/// Document scopes a row may carry. The first four are the Agent Run scopes a
/// watcher records; `task` and `plan` are also what an authorized rescan
/// records for the task and module-scratch buckets.
pub const DOCUMENT_SCOPES: &[&str] = &["task", "plan", "instant", "docchat"];

pub const DJANGO_MIGRATIONS: [&str; 1] = [CURRENT_DJANGO_LEAF];

pub async fn install(
    database: &sea_orm::DatabaseConnection,
    stable_digest: &str,
) -> Result<(), DocumentsPersistenceError> {
    let transaction = database.begin().await.map_err(storage)?;
    let installed = columns(&transaction, "design_documents").await?;
    if !installed.contains(ADOPTED_COLUMN) {
        transaction
            .execute_unprepared(
                "ALTER TABLE design_documents ADD COLUMN content_digest varchar NULL",
            )
            .await
            .map_err(storage)?;
    }
    transaction
        .execute_unprepared(LEDGER_SCHEMA)
        .await
        .map_err(storage)?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO ticketry_documents_adoption (singleton, version, source_leaf, stable_digest) VALUES (1, ?, ?, ?)",
            [VERSION.into(), CURRENT_DJANGO_LEAF.into(), stable_digest.into()],
        ))
        .await
        .map_err(storage)?;
    transaction.commit().await.map_err(storage)?;
    Ok(())
}

pub async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, DocumentsPersistenceError> {
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
CREATE TABLE ticketry_documents_adoption (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    source_leaf varchar(255) NOT NULL,
    stable_digest char(64) NOT NULL,
    adopted_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"#;

fn storage(source: sea_orm::DbErr) -> DocumentsPersistenceError {
    DocumentsPersistenceError::storage("Documents schema operation failed", source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_adopted_column_is_not_one_django_already_created() {
        assert!(!DJANGO_COLUMNS.contains(&ADOPTED_COLUMN));
    }

    #[test]
    fn the_known_history_ends_at_the_classified_leaf() {
        assert_eq!(DJANGO_MIGRATIONS.last(), Some(&CURRENT_DJANGO_LEAF));
    }
}
