//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file declares the module tree and exports the single entry point
//! `main.rs` calls. The desktop shell itself lives in [`desktop`].

pub(crate) mod app_updates;
pub mod desktop;
pub mod documents;
pub mod execution;
pub mod graph_run_service;
pub mod graphql_foundation;
pub mod hook_spool;
pub mod installation;
pub mod launch;
pub mod mcp;
pub mod module_links;
pub mod native_terminal;
pub mod query_root;
pub mod run_authority;
pub mod runs;
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
    desktop::run(false);
}

pub fn run_with_file_logging(requested: bool) {
    desktop::run(requested);
}

pub fn file_logging_requested(arguments: &[std::ffi::OsString]) -> bool {
    ticketry_diagnostics::file_logging_requested(arguments)
}

pub fn configure_file_logging(
    data_directory: &std::path::Path,
    log_path: Option<std::path::PathBuf>,
) -> bool {
    ticketry_diagnostics::configure_process_file_log(log_path.is_some(), data_directory, log_path)
        .is_enabled()
}
