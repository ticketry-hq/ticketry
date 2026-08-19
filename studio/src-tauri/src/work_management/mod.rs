//! WorkTracker queries plus the isolated Rust-authored command path.

pub mod adoption;
pub mod commands;
pub mod database;
pub use crate::entities::work_management as entities;
pub mod launch_policy;
pub mod mcp;
pub mod ownership_manifest;
pub mod read_queries;
pub use crate::query_root::types as read_types;
mod transition_occurrences;

pub use database::{
    open, open_established, open_for_commands, state_database_path, ReadDatabaseError,
};
