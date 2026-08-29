//! WorkTracker queries plus the isolated Rust-authored command path.

pub mod adoption;
pub mod commands;
pub mod database;
pub mod final_schema_migrations;
pub use crate::entities::work_management as entities;
pub(crate) mod graphql;
pub(crate) mod issue_type;
pub mod launch_binding_entry_skill_migration;
pub mod launch_policy;
pub mod mcp;
pub mod module_presentation_migration;
pub mod ownership_manifest;
pub mod project_onboarding_migration;
pub mod read_queries;
pub mod read_types;
mod transition_occurrences;
pub mod workflow_color_migration;
pub mod workspace_tab_order;
pub mod workspace_tab_order_migration;

#[cfg(test)]
mod module_presentation_commands_tests;

pub use database::{
    open, open_established, open_for_commands, state_database_path, ReadDatabaseError,
};
