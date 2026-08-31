//! Optional process diagnostics shared by the native shell and domain services.

mod crash_report;
mod file_log;
mod launch_discovery;
pub mod launch_trace;

pub use crash_report::{
    clean_session_marker, collect_dirty_shutdown, system_diagnostic_reports_directory,
};

pub use file_log::{
    configure_process_file_log, file_logging_requested, record_story_move, FileLog,
};
pub use launch_discovery::{
    record as record_launch_discovery, runtime_instance, LaunchDiscoveryRecord,
};
pub use launch_trace::{
    attempt_keyed_stages, correlate as correlate_launch_traces, is_path_stage, is_pre_commit_stage,
    path_stages, records_from_log as launch_trace_records_from_log, render as render_launch_trace,
    report_for_agent_run as launch_trace_for_agent_run,
    report_for_launch_attempt as launch_trace_for_launch_attempt, stage_index, LaunchTraceRecord,
    LaunchTraceReport, ReportedEnd, ReportedStage, StageOutcome, TraceVerdict, COMMIT_STAGES,
    EXECUTION_STAGES, FINAL_STAGE, JOIN_STAGE, PRE_COMMIT_STAGES, RUN_ENDED_STAGE, SWEEP_STAGE,
    VISIBILITY_STAGES,
};
