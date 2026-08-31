//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file declares the module tree and exports the single entry point
//! `main.rs` calls. The desktop shell itself lives in [`desktop`].

pub(crate) mod app_updates;
pub mod desktop;
pub mod graphql_foundation;
pub mod native_terminal;
pub mod query_root;

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
