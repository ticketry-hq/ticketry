//! Optional process diagnostics shared by the native shell and domain services.

mod file_log;

pub(crate) use file_log::{
    configure_process_file_log, file_logging_requested, record_story_move, FileLog,
};
