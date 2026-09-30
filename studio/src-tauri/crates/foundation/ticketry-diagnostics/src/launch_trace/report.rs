//! The pure correlation reader: trace records in, one timed report per launch.
//!
//! No I/O, no clock, no state. The reader answers the question the records
//! were added to answer — which stage did this launch last reach, and did that
//! stage complete, refuse, or simply stop.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::record::{LaunchTraceRecord, StageOutcome};
use super::stages::{stage_index, FINAL_STAGE, JOIN_STAGE, RUN_ENDED_STAGE, SWEEP_STAGE};

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

/// One stage as reported: when it happened and how long since the previous
/// stage in wall-clock order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportedStage {
    pub event: String,
    pub timestamp: DateTime<Utc>,
    pub elapsed_from_previous_ms: Option<i64>,
    pub outcome: StageOutcome,
    pub refusal_reason: Option<String>,
    pub provider: Option<String>,
    /// How many records reached this stage. The visibility stages recur on
    /// every status event for as long as the run lives; the path reports the
    /// first reach and counts the rest.
    pub occurrences: usize,
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

/// The join stage carries both identities; that pairing joins the two halves.
///
/// Only the join record is trusted first. The older launch-discovery commit
/// record also writes a `launchAttemptId`, but it is the launch request's
/// identity, not the trace attempt's, and it is logged before the join record;
/// letting it claim the run split one live launch into two reports. Any other
/// pairing is a fallback for a run no join record ever claimed.
fn join_identities(records: &[LaunchTraceRecord]) -> HashMap<String, String> {
    let mut attempt_of_run: HashMap<String, String> = HashMap::new();
    let pairings = records
        .iter()
        .filter(|record| record.event == JOIN_STAGE)
        .chain(records.iter().filter(|record| record.event != JOIN_STAGE));
    for record in pairings {
        if let (Some(attempt), Some(run)) = (&record.launch_attempt_id, &record.agent_run_id) {
            // The first attempt to claim a run keeps it. An Agent Run belongs
            // to one launch, so a second claim is corruption in the records
            // rather than a correction, and must not move the first launch's
            // stages onto another report.
            attempt_of_run
                .entry(run.clone())
                .or_insert_with(|| attempt.clone());
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
    record.launch_attempt_id.clone().or_else(|| {
        record.swept_agent_run_ids.first().map(|run| {
            attempt_of_run
                .get(run)
                .cloned()
                .unwrap_or_else(|| run.clone())
        })
    })
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
    for record in &path {
        if let Some(reached) = stages
            .last_mut()
            .filter(|stage| stage.event == record.event)
        {
            // A later record of a stage already reached is a recurrence, not a
            // new step on the path. A refusal among the recurrences still ends
            // the trace, so it is kept.
            reached.occurrences += 1;
            if record.outcome == StageOutcome::Refused && reached.outcome != StageOutcome::Refused {
                reached.outcome = StageOutcome::Refused;
                reached.refusal_reason = record.refusal_reason.clone();
            }
            continue;
        }
        stages.push(ReportedStage {
            event: record.event.clone(),
            timestamp: record.timestamp,
            elapsed_from_previous_ms: None,
            outcome: record.outcome,
            refusal_reason: record.refusal_reason.clone(),
            provider: record.provider.clone(),
            occurrences: 1,
        });
    }

    let mut chronological: Vec<usize> = (0..stages.len()).collect();
    chronological.sort_by(|left, right| {
        stages[*left]
            .timestamp
            .cmp(&stages[*right].timestamp)
            .then_with(|| left.cmp(right))
    });
    let mut previous: Option<DateTime<Utc>> = None;
    for index in chronological {
        let timestamp = stages[index].timestamp;
        stages[index].elapsed_from_previous_ms =
            previous.map(|earlier| (timestamp - earlier).num_milliseconds());
        previous = Some(timestamp);
    }

    let last_stage_reached = stages.last().map(|stage| stage.event.clone());
    let verdict = verdict_for(&stages);
    let total_elapsed_ms = chronological_span_ms(&records);

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

fn chronological_span_ms(records: &[&LaunchTraceRecord]) -> Option<i64> {
    let earliest = records.iter().map(|record| record.timestamp).min()?;
    let latest = records.iter().map(|record| record.timestamp).max()?;
    Some((latest - earliest).num_milliseconds())
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

/// Reads how a run ended.
///
/// The earliest attributed record wins: the first thing that ended the run is
/// what ended it, and the records that follow describe the shutdown it caused.
/// An unattributed record never displaces an attributed one, and process detail
/// is taken from whichever record observed it.
fn end_of_life_for(records: &[&LaunchTraceRecord]) -> Option<ReportedEnd> {
    let ends: Vec<&LaunchTraceRecord> = records
        .iter()
        .copied()
        .filter(|record| record.event == RUN_ENDED_STAGE || record.event == SWEEP_STAGE)
        .collect();
    let attributed = |record: &&LaunchTraceRecord| {
        record
            .end_of_life_origin
            .as_deref()
            .is_some_and(|origin| origin != UNATTRIBUTED)
    };
    let chosen = ends
        .iter()
        .copied()
        .filter(attributed)
        .min_by_key(|record| record.timestamp)
        .or_else(|| ends.iter().copied().max_by_key(|record| record.timestamp))?;
    Some(ReportedEnd {
        origin: chosen
            .end_of_life_origin
            .clone()
            .unwrap_or_else(|| UNATTRIBUTED.to_owned()),
        timestamp: chosen.timestamp,
        exit_code: chosen
            .exit_code
            .or_else(|| ends.iter().find_map(|record| record.exit_code)),
        terminating_signal: chosen.terminating_signal.clone().or_else(|| {
            ends.iter()
                .find_map(|record| record.terminating_signal.clone())
        }),
        swept_run_count: chosen
            .swept_run_count
            .or_else(|| ends.iter().find_map(|record| record.swept_run_count)),
    })
}

const UNATTRIBUTED: &str = "unattributed";

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
