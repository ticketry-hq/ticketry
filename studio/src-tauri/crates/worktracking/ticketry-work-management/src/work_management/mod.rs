//! WorkTracker queries plus the isolated Rust-authored command path.

pub mod adoption;
pub mod commands;
pub(crate) mod database;
pub mod graphql;
pub(crate) mod issue_type;
pub(crate) mod issue_type_transition;
pub(crate) mod launch_binding;
pub mod launch_binding_entry_skill_migration;
pub mod launch_binding_profile_migration;
pub mod launch_binding_stage_skills_migration;
pub mod launch_policy;
pub(crate) mod module_presentation;
pub mod module_presentation_migration;
pub mod ownership_manifest;
pub(crate) mod project;
pub mod project_onboarding_migration;
pub mod read_queries;
pub mod read_types;
mod sprint;
mod sprint_goal;
mod sprint_suggestion;
pub mod sprint_migration;
mod sprint_execution_migration;
pub use sprint_execution_migration::install as install_sprint_execution_schema;
pub(crate) mod state;
pub mod tag_migration;
mod transition_occurrences;
pub(crate) mod work_item;
pub mod workflow_color_migration;
pub mod workflow_handoff_migration;
pub(crate) mod workspace_tab_order;
pub mod workspace_tab_order_migration;

pub use database::{
    begin_write, open, open_established, open_for_commands, state_database_path, ReadDatabaseError,
};

/// Record one suggestion in the caller's publication transaction.
pub async fn record_in(
    transaction: &sea_orm::DatabaseTransaction,
    project_id: &str,
    run_id: &str,
    input: commands::sprint_suggestions::RecordSprintSuggestion,
) -> Result<ticketry_entities::sprint_suggestion::Model, commands::CommandError> {
    commands::sprint_suggestions::record_in(transaction, project_id, run_id, input).await
}
