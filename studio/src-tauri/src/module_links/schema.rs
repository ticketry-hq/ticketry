//! The Rust-authored `module_links` schema.
//!
//! This table has never had a Django writer. Installation is deterministic and
//! repeatable, so a restart, an adoption pass, and a fresh database converge on
//! the same shape: the DDL is idempotent and the recorded version is the
//! contract [`super::ownership_manifest`] asserts against.
//!
//! Two invariants are stated in SQL rather than only in Rust, because they are
//! the ones a row could otherwise violate through any future writer:
//!
//! * **One link per Module.** A unique index on `module_id` is what makes the
//!   Module the link's owner rather than one of several candidates.
//! * **The link dies with its Module.** The foreign key cascades on delete, so
//!   deleting a Module can never strand a link naming an identity that no
//!   longer resolves. Archiving a Module is not a delete and deliberately
//!   keeps the link, so unarchiving restores the folder the user chose.
//!
//! Path *shape* is checked in [`super::local_path`], where the rule can be
//! platform-correct. SQL only refuses the two shapes no platform allows.

use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait};

use super::{ModuleLinkError, ModuleLinkErrorCode};

/// Version of the authored Module Link schema.
pub const VERSION: i32 = 1;

/// The typed link table.
pub const LINK_TABLE: &str = "module_links";

/// The ledger recording which authored schema version is installed.
pub const SCHEMA_TABLE: &str = "ticketry_module_links_schema";

/// The tables this capability authors outright.
pub const AUTHORED_TABLES: &[&str] = &[LINK_TABLE, SCHEMA_TABLE];

/// The link columns, at their checked shape.
pub(crate) const LINK_COLUMNS: &[&str] =
    &["id", "module_id", "path", "created_at", "updated_at"];

/// The schema-ledger columns, at their checked shape.
pub(crate) const SCHEMA_COLUMNS: &[&str] = &["singleton", "version", "installed_at"];

/// Install the typed link table. Running this twice is a no-op; running it
/// against a database carrying a different version is a typed refusal rather
/// than a silent migration.
///
/// # Errors
///
/// Returns [`ModuleLinkErrorCode::Storage`] when the DDL cannot run, and
/// [`ModuleLinkErrorCode::Schema`] when the installed shape is not this
/// release's.
pub async fn install(database: &DatabaseConnection) -> Result<(), ModuleLinkError> {
    let transaction = database.begin().await?;
    transaction.execute_unprepared(FOCUSED_SCHEMA).await?;
    transaction
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT OR IGNORE INTO ticketry_module_links_schema (singleton, version) VALUES (1, ?)",
            [VERSION.into()],
        ))
        .await?;
    transaction.commit().await?;
    verify(database).await
}

/// Prove the installed schema matches the checked contract.
///
/// # Errors
///
/// Returns [`ModuleLinkErrorCode::Schema`] when the recorded version or either
/// table's columns are not this release's.
pub async fn verify(database: &impl ConnectionTrait) -> Result<(), ModuleLinkError> {
    let version = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT version FROM ticketry_module_links_schema WHERE singleton = 1",
        ))
        .await?
        .map(|row| row.try_get::<i32>("", "version"))
        .transpose()?;
    if version != Some(VERSION) {
        return Err(ModuleLinkError::new(
            ModuleLinkErrorCode::Schema,
            "The Module Link schema version is not the supported version.",
        ));
    }
    for (table, expected) in [(LINK_TABLE, LINK_COLUMNS), (SCHEMA_TABLE, SCHEMA_COLUMNS)] {
        let installed = columns(database, table).await?;
        let expected = expected
            .iter()
            .copied()
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        if installed != expected {
            return Err(ModuleLinkError::new(
                ModuleLinkErrorCode::Schema,
                format!("The {table} columns do not match the checked contract."),
            ));
        }
    }
    Ok(())
}

/// Whether the typed link table has been installed in this database.
///
/// # Errors
///
/// Returns [`ModuleLinkErrorCode::Storage`] when the schema cannot be listed.
pub async fn installed(database: &impl ConnectionTrait) -> Result<bool, ModuleLinkError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
            [LINK_TABLE.into()],
        ))
        .await?
        .ok_or_else(|| {
            ModuleLinkError::new(
                ModuleLinkErrorCode::Storage,
                "The installation's schema could not be inspected.",
            )
        })?;
    Ok(row.try_get::<i64>("", "count")? == 1)
}

pub(crate) async fn columns(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<BTreeSet<String>, ModuleLinkError> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await?;
    rows.into_iter()
        .map(|row| Ok(row.try_get::<String>("", "name")?))
        .collect()
}

const FOCUSED_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS ticketry_module_links_schema (
    singleton integer PRIMARY KEY CHECK (singleton = 1),
    version integer NOT NULL CHECK (version = 1),
    installed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS module_links (
    id char(32) NOT NULL PRIMARY KEY,
    module_id char(32) NOT NULL
        REFERENCES worktracker_issue (id) ON DELETE CASCADE,
    path varchar(1024) NOT NULL CHECK (path <> '' AND path = trim(path)),
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_module_link_module
    ON module_links(module_id);
"#;
