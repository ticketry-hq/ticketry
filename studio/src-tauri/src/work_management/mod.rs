//! WorkTracker queries plus the isolated Rust-authored command path.

pub mod adoption;
pub mod commands;
pub mod database;
pub use crate::entities::work_management as entities;
pub(crate) mod graphql;
pub mod launch_policy;
pub mod mcp;
pub mod migrations;
pub mod ownership_manifest;
pub mod read_queries;
pub mod read_types;
pub mod run_configuration;
mod transition_occurrences;

#[cfg(test)]
mod run_configuration_tests;

pub use database::{
    open, open_established, open_for_commands, state_database_path, ReadDatabaseError,
};
