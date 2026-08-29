//! Recognize an installation Rust already owns, and refuse a newer one.
//!
//! Each capability records its handoff in its own singleton ledger. Reopening
//! an adopted installation must be idempotent, so their presence is an answer
//! rather than a defect. A ledger written by a newer Ticketry is refused: this
//! binary cannot know what that release changed.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::outcome::{ClassificationError, Refusal, RustOwnership};

/// Every capability ledger this binary owns, with the version it writes.
///
/// The versions come from the capabilities themselves, so a capability that
/// bumps its ownership version cannot leave classification behind.
pub fn owned_ledgers() -> Vec<(&'static str, i32)> {
    vec![
        // The installation ledger comes first because it is the one that says
        // Rust owns the installation as a whole. A crash between its commit and
        // the capability handoffs must still reopen as Rust-owned, which is
        // exactly what its presence here means.
        (
            crate::installation::adoption::LEDGER_TABLE,
            crate::installation::adoption::ledger::VERSION,
        ),
        (
            "ticketry_worktracker_adoption",
            crate::work_management::ownership_manifest::VERSION,
        ),
        (
            crate::work_management::workflow_color_migration::LEDGER_TABLE,
            crate::work_management::workflow_color_migration::VERSION,
        ),
        (
            crate::work_management::workspace_tab_order_migration::LEDGER_TABLE,
            crate::work_management::workspace_tab_order_migration::VERSION,
        ),
        (
            crate::work_management::project_onboarding_migration::LEDGER_TABLE,
            crate::work_management::project_onboarding_migration::VERSION,
        ),
        (
            "ticketry_settings_adoption",
            crate::settings_persistence::ownership_manifest::VERSION,
        ),
        ("ticketry_runs_adoption", crate::runs_persistence::VERSION),
        (
            crate::terminal::persistence::LEDGER_TABLE,
            crate::terminal::persistence::VERSION,
        ),
        (
            "ticketry_execution_adoption",
            crate::execution::persistence::VERSION,
        ),
        (
            crate::documents::persistence::LEDGER_TABLE,
            crate::documents::persistence::VERSION,
        ),
        (
            crate::worktree::persistence::LEDGER_TABLE,
            crate::worktree::persistence::VERSION,
        ),
    ]
}

/// Report Rust ownership when any capability ledger is present.
///
/// Returns `None` when no ledger exists, which leaves the installation to the
/// Django and Alembic classifiers.
pub async fn inspect(
    database: &DatabaseConnection,
    present_tables: &[String],
) -> Result<Option<RustOwnership>, ClassificationError> {
    let mut adopted = Vec::new();
    let mut pending = Vec::new();
    for (table, expected) in owned_ledgers() {
        if !present_tables.iter().any(|name| name == table) {
            pending.push(table.to_owned());
            continue;
        }
        let version = ledger_version(database, table).await?;
        if version > expected {
            return Err(ClassificationError::new(
                Refusal::FutureGeneration,
                format!(
                    "{table} records ownership version {version}, which is newer than this release's {expected}"
                ),
            ));
        }
        if version != expected {
            return Err(ClassificationError::new(
                Refusal::UnsupportedGeneration,
                format!("{table} records unsupported ownership version {version}"),
            ));
        }
        adopted.push(table.to_owned());
    }
    if adopted.is_empty() {
        return Ok(None);
    }
    Ok(Some(RustOwnership { adopted, pending }))
}

async fn ledger_version(
    database: &DatabaseConnection,
    table: &str,
) -> Result<i32, ClassificationError> {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT version FROM {table} WHERE singleton = 1"),
        ))
        .await
        .map_err(|error| {
            ClassificationError::new(
                Refusal::UnreadableInstallation,
                format!("could not read {table}: {error}"),
            )
        })?
        .ok_or_else(|| {
            ClassificationError::new(
                Refusal::LedgerDisagreesWithSchema,
                format!("{table} exists but records no ownership row"),
            )
        })?;
    row.try_get::<i32>("", "version").map_err(|error| {
        ClassificationError::new(
            Refusal::LedgerDisagreesWithSchema,
            format!("{table} records an unreadable ownership version: {error}"),
        )
    })
}
