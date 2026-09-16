#![deny(private_bounds, private_interfaces)]

//! Optional process diagnostics shared by the native shell and domain services.

mod crash_report;
mod file_log;
mod launch_discovery;
mod launch_trace;
mod native_crash_report;
mod native_report_retry;
mod panic_attribution;

#[cfg(test)]
#[path = "panic_attribution_concurrency_tests.rs"]
mod panic_attribution_concurrency_tests;
#[cfg(test)]
#[path = "panic_attribution_tests.rs"]
mod panic_attribution_tests;

pub use crash_report::{
    clean_session_marker, collect_dirty_shutdown, system_diagnostic_reports_directory,
};

pub use file_log::{
    configure_process_file_log, file_logging_requested, process_file_log, record_story_move,
    FileLog,
};
pub use launch_discovery::{
    record as record_launch_discovery, runtime_instance, LaunchDiscoveryRecord,
    LaunchRequestSurface, LaunchRequestedRecord,
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
#[cfg(debug_assertions)]
pub use panic_attribution::force_development_panic_abort;
pub use panic_attribution::{
    catch_unwind_without_crash_attribution, install_hook as install_panic_attribution_hook,
};
