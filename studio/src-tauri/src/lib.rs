//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file declares the module tree and exports the single entry point
//! `main.rs` calls. The desktop shell itself lives in [`desktop`].

pub mod desktop;
pub mod discovery;
pub mod document_watch;
pub mod documents;
pub mod documents_persistence;
pub mod entities;
pub mod graphql_foundation;
pub mod launch_paths;
pub mod native_terminal;
pub mod ownership;
pub mod query_root;
mod release_manifest;
pub mod runs_effect_port;
pub mod runs_persistence;
pub mod settings_persistence;
pub mod supervisor;
pub mod terminal_runtime;
mod tmux_viewer;
pub mod viewer_commands;
pub mod work_management;
pub mod workspace_handoff;
pub mod workspace_operations;
pub mod worktree_create;
pub mod worktree_discard;
pub mod worktree_facts;
pub mod worktree_integrate;
pub mod worktree_operations;
pub mod worktree_persistence;
pub mod worktree_status;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop::run();
}
