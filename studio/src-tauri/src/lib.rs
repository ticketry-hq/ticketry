//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file declares the module tree and exports the single entry point
//! `main.rs` calls. The desktop shell itself lives in [`desktop`].

pub mod data_directory;
pub mod desktop;
pub mod document_watch;
pub mod documents;
pub mod documents_persistence;
pub mod entities;
pub mod execution_graph;
pub mod execution_persistence;
pub mod execution_reconciliation;
pub mod graph_run_service;
pub mod graphql_foundation;
pub mod hook_spool;
pub mod launch_paths;
pub mod launch_planning;
pub mod native_terminal;
pub mod query_root;
pub mod run_now;
pub mod runs_persistence;
pub mod settings_persistence;
pub mod sidecar_supervision;
pub mod terminal_cleanup;
pub mod terminal_launch;
pub mod terminal_lifecycle;
pub mod terminal_output_activity;
pub mod terminal_persistence;
pub mod terminal_reconciliation;
pub mod terminal_resume;
pub mod terminal_viewer;
pub mod tmux_adapter;
pub mod tool_discovery;
pub mod viewer_ownership;
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
