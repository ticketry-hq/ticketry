//! Optional process diagnostics shared by the native shell and domain services.

mod crash_report;
mod file_log;
mod launch_discovery;
mod launch_trace;

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
    admitted, attempt_committed, attempt_keyed_stages, correlate as correlate_launch_traces,
    current, is_path_stage, is_pre_commit_stage, path_stages,
    records_from_log as launch_trace_records_from_log, refused, render as render_launch_trace,
    report_for_agent_run as launch_trace_for_agent_run,
    report_for_launch_attempt as launch_trace_for_launch_attempt, requested_by, stage, stage_index,
    within, AttemptFacts, LaunchAttempt, LaunchSurface, LaunchTraceRecord, LaunchTraceReport,
    ReportedEnd, ReportedStage, StageOutcome, StageProbe, TraceVerdict, ARGV_MATERIALISED,
    AUTHORITY_RESOLVED, COMMIT_STAGES, DIRECTORY_PREFLIGHTED, EXECUTABLE_RESOLVED,
    EXECUTION_STAGES, FINAL_STAGE, JOIN_STAGE, POLICY_EVALUATED, PRE_COMMIT_STAGES,
    PROMPT_DELIVERED, PROVIDER_VALIDATED, REQUESTED, RUNTIME_SPAWNED, RUN_ENDED_STAGE, SWEEP_STAGE,
    VISIBILITY_STAGES,
};
