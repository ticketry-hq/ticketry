//! Crate root for the Ticketry Studio desktop binary.
//!
//! This file exports the single entry point `main.rs` calls. The desktop
//! shell itself — every Tauri command, the taurpc router, plugin setup and
//! the `tauri::Builder` — lives in [`ticketry_desktop`].

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_file_logging(false);
}

/// Hands the shell its Tauri context and runs it.
///
/// `tauri::generate_context!` reads what `build.rs` writes into this
/// package's `OUT_DIR`, and `tauri-build` stays here with `tauri.conf.json`,
/// so the context is built once at the root and passed down. Expanding the
/// macro a second time would redefine `_EMBED_INFO_PLIST`.
pub fn run_with_file_logging(requested: bool) {
    ticketry_desktop::desktop::run(tauri::generate_context!(), requested);
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
