//! Launch-path tracing: the stage vocabulary, the records, and the reader that
//! turns them into one ordered, timed report per launch.

mod log_records;
mod record;
mod render;
mod report;
mod stages;

#[cfg(test)]
mod tests;

pub use log_records::records_from_log;
pub use record::{LaunchTraceRecord, StageOutcome};
pub use render::render;
pub use report::{
    correlate, report_for_agent_run, report_for_launch_attempt, LaunchTraceReport, ReportedEnd,
    ReportedStage, TraceVerdict,
};
pub use stages::{
    is_path_stage, is_pre_commit_stage, stage_index, FINAL_STAGE, JOIN_STAGE, POST_COMMIT_STAGES,
    PRE_COMMIT_STAGES, RUN_ENDED_STAGE, SWEEP_STAGE,
};
