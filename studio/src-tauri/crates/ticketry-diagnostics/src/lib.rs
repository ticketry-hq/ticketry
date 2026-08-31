//! Optional process diagnostics shared by the native shell and domain services.

mod crash_report;
mod file_log;
mod launch_discovery;

pub use crash_report::{
    clean_session_marker, collect_dirty_shutdown, system_diagnostic_reports_directory,
};

pub use file_log::{
    configure_process_file_log, file_logging_requested, record_story_move, FileLog,
};
pub use launch_discovery::{
    record as record_launch_discovery, runtime_instance, LaunchDiscoveryRecord,
};
