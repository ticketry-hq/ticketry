//! Optional process diagnostics shared by the native shell and domain services.

mod crash_report;
mod file_log;
mod launch_discovery;
mod native_crash_report;
mod native_minidump_report;
mod panic_attribution;

pub(crate) use crash_report::{
    clean_session_marker, collect_dirty_shutdown, system_diagnostic_reports_directory,
};
pub(crate) use native_minidump_report::ghostty_sentry_database_directory;

pub(crate) use file_log::{
    configure_process_file_log, file_logging_requested, record_story_move, FileLog,
};
pub(crate) use launch_discovery::{
    record as record_launch_discovery, runtime_instance, LaunchDiscoveryRecord,
    LaunchRequestSurface, LaunchRequestedRecord,
};
#[cfg(debug_assertions)]
pub(crate) use panic_attribution::force_development_panic_abort;
pub(crate) use panic_attribution::install_hook as install_panic_attribution_hook;
