//! Launch-path tracing: what asked for a launch, and how far it got.
//!
//! Both halves live here. The emitting half is the ambient launch attempt, the
//! surface that requested it, and the probes each stage writes; the reading
//! half turns those records into one ordered, timed report per launch. They
//! share one stage vocabulary in [`stages`], which is the whole reason they
//! sit together: a probe and the reader cannot drift apart on a spelling.

mod attempt;
mod log_records;
mod probe;
mod record;
mod render;
mod report;
pub mod stages;
mod surface;

#[cfg(test)]
mod probe_tests;
#[cfg(test)]
mod tests;

pub use attempt::{current, requested_by, within, AttemptFacts, LaunchAttempt};
pub use log_records::records_from_log;
pub use probe::{admitted, attempt_committed, refused, stage, StageProbe};
pub use record::{LaunchTraceRecord, StageOutcome};
pub use render::render;
pub use report::{
    correlate, report_for_agent_run, report_for_launch_attempt, LaunchTraceReport, ReportedEnd,
    ReportedStage, TraceVerdict,
};
pub use stages::{
    attempt_keyed_stages, is_path_stage, is_pre_commit_stage, path_stages, stage_index,
    COMMIT_STAGES, EXECUTION_STAGES, FINAL_STAGE, JOIN_STAGE, PRE_COMMIT_STAGES, RUN_ENDED_STAGE,
    SWEEP_STAGE, VISIBILITY_STAGES,
};
pub use surface::LaunchSurface;
