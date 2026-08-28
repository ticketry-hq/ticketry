//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file declares the module tree and exports the single entry point
//! `main.rs` calls. The desktop shell itself lives in [`desktop`].

pub mod data_directory;
pub mod desktop;
pub mod documents;
pub mod execution;
pub mod entities;
pub mod graph_run_service;
pub mod graphql_foundation;
pub mod hook_spool;
pub mod installation;
pub mod launch;
pub mod native_terminal;
pub mod query_root;
pub mod run_now;
pub mod runs_persistence;
pub mod settings_persistence;
pub mod temporary_profile;
pub mod terminal;
pub mod tmux_adapter;
pub mod tool_discovery;
pub mod viewer_ownership;
pub mod work_management;
pub mod workspace;
pub mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop::run();
}
