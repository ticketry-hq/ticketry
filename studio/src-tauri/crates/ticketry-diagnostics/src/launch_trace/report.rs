//! The pure correlation reader: trace records in, one timed report per launch.
//!
//! No I/O, no clock, no state. The reader answers the question the records
//! were added to answer — which stage did this launch last reach, and did that
//! stage complete, refuse, or simply stop.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::record::{LaunchTraceRecord, StageOutcome};
use super::stages::{stage_index, FINAL_STAGE, RUN_ENDED_STAGE, SWEEP_STAGE};

/// What the trace as a whole says happened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TraceVerdict {
    /// The launch reached the workspace render.
    Completed,
    /// A stage refused, and said why.
    Refused {
        stage: String,
        reason: Option<String>,
    },
    /// The trace stops at a stage that neither completed the path nor refused.
    /// A trace ending this way is itself the finding.
    Incomplete { last_stage: String },
    /// No path stage was recorded for this identity at all.
    Empty,
}

/// One stage as reported: when it happened and how long since the one before.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportedStage {
    pub event: String,
    pub timestamp: DateTime<Utc>,
    pub elapsed_from_previous_ms: Option<i64>,
    pub outcome: StageOutcome,
    pub refusal_reason: Option<String>,
    pub provider: Option<String>,
}

/// How an Agent Run's life ended, when it has ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportedEnd {
    pub origin: String,
    pub timestamp: DateTime<Utc>,
    pub exit_code: Option<i64>,
    pub terminating_signal: Option<String>,
    pub swept_run_count: Option<i64>,
}

/// One launch attempt's ordered, timed report.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchTraceReport {
    pub launch_attempt_id: Option<String>,
    pub agent_run_id: Option<String>,
    pub project_id: Option<String>,
    pub provider: Option<String>,
    pub stages: Vec<ReportedStage>,
    pub last_stage_reached: Option<String>,
    pub total_elapsed_ms: Option<i64>,
    pub verdict: TraceVerdict,
    pub end_of_life: Option<ReportedEnd>,
}

/// Groups records into one report per launch, in path order.
pub fn correlate(records: &[LaunchTraceRecord]) -> Vec<LaunchTraceReport> {
    let attempt_of_run = join_identities(records);
    let mut grouped: HashMap<String, Vec<&LaunchTraceRecord>> = HashMap::new();
    for record in records {
        if let Some(key) = group_key(record, &attempt_of_run) {
            grouped.entry(key).or_default().push(record);
        }
    }
    let mut reports: Vec<LaunchTraceReport> = grouped.into_values().map(report_for).collect();
    reports.sort_by(|left, right| {
        let left_start = left.stages.first().map(|stage| stage.timestamp);
        let right_start = right.stages.first().map(|stage| stage.timestamp);
        left_start
            .cmp(&right_start)
            .then_with(|| left.launch_attempt_id.cmp(&right.launch_attempt_id))
            .then_with(|| left.agent_run_id.cmp(&right.agent_run_id))
    });
    reports
}

/// Reads the report for one identity's records, ignoring everything else.
pub fn report_for_agent_run(
    records: &[LaunchTraceRecord],
    agent_run_id: &str,
) -> LaunchTraceReport {
    correlate(records)
        .into_iter()
        .find(|report| report.agent_run_id.as_deref() == Some(agent_run_id))
        .unwrap_or_else(|| empty_report(None, Some(agent_run_id.to_owned())))
}

/// Reads the report for one launch attempt, including attempts that never
/// reached the commit and so never gained an Agent Run identity.
pub fn report_for_launch_attempt(
    records: &[LaunchTraceRecord],
    launch_attempt_id: &str,
) -> LaunchTraceReport {
    correlate(records)
        .into_iter()
        .find(|report| report.launch_attempt_id.as_deref() == Some(launch_attempt_id))
        .unwrap_or_else(|| empty_report(Some(launch_attempt_id.to_owned()), None))
}

/// The commit stage carries both identities; that pairing joins the two halves.
fn join_identities(records: &[LaunchTraceRecord]) -> HashMap<String, String> {
    let mut attempt_of_run = HashMap::new();
    for record in records {
        if let (Some(attempt), Some(run)) = (&record.launch_attempt_id, &record.agent_run_id) {
            attempt_of_run.insert(run.clone(), attempt.clone());
        }
    }
    attempt_of_run
}

fn group_key(
    record: &LaunchTraceRecord,
    attempt_of_run: &HashMap<String, String>,
) -> Option<String> {
    if let Some(run) = &record.agent_run_id {
        return Some(
            attempt_of_run
                .get(run)
                .cloned()
                .unwrap_or_else(|| run.clone()),
        );
    }
    record.launch_attempt_id.clone()
}

fn report_for(records: Vec<&LaunchTraceRecord>) -> LaunchTraceReport {
    let mut path: Vec<&LaunchTraceRecord> = records
        .iter()
        .copied()
        .filter(|record| stage_index(&record.event).is_some())
        .collect();
    path.sort_by(|left, right| {
        stage_index(&left.event)
            .cmp(&stage_index(&right.event))
            .then_with(|| left.timestamp.cmp(&right.timestamp))
    });

    let mut stages: Vec<ReportedStage> = Vec::with_capacity(path.len());
    let mut previous: Option<DateTime<Utc>> = None;
    for record in &path {
        stages.push(ReportedStage {
            event: record.event.clone(),
            timestamp: record.timestamp,
            elapsed_from_previous_ms: previous
                .map(|earlier| (record.timestamp - earlier).num_milliseconds()),
            outcome: record.outcome,
            refusal_reason: record.refusal_reason.clone(),
            provider: record.provider.clone(),
        });
        previous = Some(record.timestamp);
    }

    let last_stage_reached = stages.last().map(|stage| stage.event.clone());
    let verdict = verdict_for(&stages);
    let total_elapsed_ms = match (stages.first(), stages.last()) {
        (Some(first), Some(last)) => Some((last.timestamp - first.timestamp).num_milliseconds()),
        _ => None,
    };

    LaunchTraceReport {
        launch_attempt_id: first_present(&records, |record| record.launch_attempt_id.clone()),
        agent_run_id: first_present(&records, |record| record.agent_run_id.clone()),
        project_id: first_present(&records, |record| record.project_id.clone()),
        provider: first_present(&records, |record| record.provider.clone()),
        stages,
        last_stage_reached,
        total_elapsed_ms,
        verdict,
        end_of_life: end_of_life_for(&records),
    }
}

fn verdict_for(stages: &[ReportedStage]) -> TraceVerdict {
    if let Some(refusal) = stages
        .iter()
        .find(|stage| stage.outcome == StageOutcome::Refused)
    {
        return TraceVerdict::Refused {
            stage: refusal.event.clone(),
            reason: refusal.refusal_reason.clone(),
        };
    }
    match stages.last() {
        None => TraceVerdict::Empty,
        Some(last) if last.event == FINAL_STAGE => TraceVerdict::Completed,
        Some(last) => TraceVerdict::Incomplete {
            last_stage: last.event.clone(),
        },
    }
}

fn end_of_life_for(records: &[&LaunchTraceRecord]) -> Option<ReportedEnd> {
    let record = records
        .iter()
        .copied()
        .filter(|record| record.event == RUN_ENDED_STAGE || record.event == SWEEP_STAGE)
        .max_by_key(|record| record.timestamp)?;
    Some(ReportedEnd {
        origin: record
            .end_of_life_origin
            .clone()
            .unwrap_or_else(|| "unattributed".to_owned()),
        timestamp: record.timestamp,
        exit_code: record.exit_code,
        terminating_signal: record.terminating_signal.clone(),
        swept_run_count: record.swept_run_count,
    })
}

fn first_present(
    records: &[&LaunchTraceRecord],
    read: impl Fn(&LaunchTraceRecord) -> Option<String>,
) -> Option<String> {
    records.iter().copied().find_map(read)
}

fn empty_report(
    launch_attempt_id: Option<String>,
    agent_run_id: Option<String>,
) -> LaunchTraceReport {
    LaunchTraceReport {
        launch_attempt_id,
        agent_run_id,
        project_id: None,
        provider: None,
        stages: Vec::new(),
        last_stage_reached: None,
        total_elapsed_ms: None,
        verdict: TraceVerdict::Empty,
        end_of_life: None,
    }
}
