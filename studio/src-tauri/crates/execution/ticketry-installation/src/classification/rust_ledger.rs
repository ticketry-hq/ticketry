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
            crate::adoption::LEDGER_TABLE,
            crate::adoption::ledger::VERSION,
        ),
        (
            "ticketry_worktracker_adoption",
            ticketry_work_management::WORK_MANAGEMENT_OWNERSHIP_VERSION,
        ),
        (
            ticketry_settings::CODEX_5_6_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_work_management::PROJECT_ONBOARDING_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::PROJECT_ONBOARDING_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::LAUNCH_BINDING_PROFILE_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::LAUNCH_BINDING_PROFILE_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::LAUNCH_BINDING_STAGE_SKILLS_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::SPRINT_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::SPRINT_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::SPRINT_RANK_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::SPRINT_RANK_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::TAG_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::TAG_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::WORKFLOW_COLOR_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::WORKFLOW_COLOR_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::WORKSPACE_TAB_ORDER_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::WORKSPACE_TAB_ORDER_MIGRATION_VERSION,
        ),
        (
            ticketry_work_management::MODULE_PRESENTATION_MIGRATION_LEDGER_TABLE,
            ticketry_work_management::MODULE_PRESENTATION_MIGRATION_VERSION,
        ),
        (
            ticketry_settings::CODEX_SPARK_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_settings::CODEX_ASTRA_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_settings::CODEX_6_ASTRA_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_settings::CODEX_GLM_5_3_FLASH_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_settings::CODEX_6_1_SOL_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            ticketry_settings::CODEX_6_SOL_LUNA_LEDGER,
            ticketry_settings::PROVIDER_CATALOG_MIGRATIONS_VERSION,
        ),
        (
            "ticketry_settings_adoption",
            ticketry_settings::OWNERSHIP_MANIFEST_VERSION,
        ),
        ("ticketry_runs_adoption", ticketry_runs::VERSION),
        (
            ticketry_terminal::LEDGER_TABLE,
            ticketry_terminal::TERMINAL_PERSISTENCE_VERSION,
        ),
        (
            "ticketry_execution_adoption",
            ticketry_agent_execution::EXECUTION_SCHEMA_VERSION,
        ),
        (
            ticketry_documents::LEDGER_TABLE,
            ticketry_documents::DOCUMENT_SCHEMA_VERSION,
        ),
        (
            ticketry_workspace_runtime::LEDGER_TABLE,
            ticketry_workspace_runtime::VERSION,
        ),
    ]
}

/// Report Rust ownership when any capability ledger is present.
///
/// Returns `None` when no ledger exists, which leaves the installation to the
/// Django and Alembic classifiers.
pub(crate) async fn inspect(
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
        if version != expected && !supported_upgrade(table, version, expected) {
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

fn supported_upgrade(table: &str, version: i32, expected: i32) -> bool {
    table == "ticketry_runs_adoption" && version == 1 && expected == 2
}

#[cfg(test)]
mod tests {
    use super::supported_upgrade;

    #[test]
    fn only_the_named_runs_v1_to_v2_upgrade_is_accepted() {
        assert!(supported_upgrade("ticketry_runs_adoption", 1, 2));
        assert!(!supported_upgrade("ticketry_runs_adoption", 2, 3));
        assert!(!supported_upgrade("ticketry_worktracker_adoption", 1, 2));
    }
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
