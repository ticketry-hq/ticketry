//! WorkTracker queries plus the isolated Rust-authored command path.

pub mod adoption;
pub mod commands;
pub mod database;
pub use crate::entities::work_management as entities;
pub(crate) mod graphql;
pub mod launch_policy;
pub mod mcp;
pub mod ownership_manifest;
pub mod project_onboarding_migration;
pub mod read_queries;
pub mod read_types;
mod transition_occurrences;
pub mod workflow_color_migration;

pub use database::{
    open, open_established, open_for_commands, state_database_path, ReadDatabaseError,
};
