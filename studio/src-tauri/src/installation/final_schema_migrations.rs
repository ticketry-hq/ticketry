//! The 0044 through 0052 parity chain, in source order.
//!
//! The chain spans work management, settings, and worktree schemas, so it is
//! installation's to compose rather than any one of theirs to own.

use sea_orm::{DatabaseConnection, DbErr};

use ticketry_settings::provider_catalog_migrations;
use ticketry_work_management::work_management::{
    launch_binding_entry_skill_migration, module_presentation_migration,
    project_onboarding_migration, workflow_color_migration, workspace_tab_order_migration,
};

pub const ORDERED_MIGRATION_IDS: &[&str] = &[
    provider_catalog_migrations::CODEX_5_6_MIGRATION_ID,
    project_onboarding_migration::MIGRATION_ID,
    launch_binding_entry_skill_migration::MIGRATION_ID,
    workflow_color_migration::MIGRATION_ID,
    workspace_tab_order_migration::MIGRATION_ID,
    module_presentation_migration::MIGRATION_ID,
    provider_catalog_migrations::CODEX_SPARK_MIGRATION_ID,
    crate::worktree::persistence::pull_request_url_migration::MIGRATION_ID,
];

pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    provider_catalog_migrations::install_codex_5_6(database)
        .await
        .map_err(|error| step_error("0044", error))?;
    project_onboarding_migration::install(database)
        .await
        .map_err(|error| step_error("0045-0046", error))?;
    launch_binding_entry_skill_migration::install(database)
        .await
        .map_err(|error| step_error("0047", error))?;
    workflow_color_migration::install(database)
        .await
        .map_err(|error| step_error("0048", error))?;
    workspace_tab_order_migration::install(database)
        .await
        .map_err(|error| step_error("0049", error))?;
    module_presentation_migration::install(database)
        .await
        .map_err(|error| step_error("0050", error))?;
    provider_catalog_migrations::install_codex_spark(database)
        .await
        .map_err(|error| step_error("0051", error))?;
    crate::worktree::persistence::pull_request_url_migration::install(database)
        .await
        .map_err(|error| step_error("0052", error))
}

fn step_error(step: &str, error: DbErr) -> DbErr {
    DbErr::Custom(format!("final-schema migration {step} failed: {error}"))
}
