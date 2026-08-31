//! The reader's cases. It is pure, so it carries the heaviest test burden.

use serde_json::json;

use super::record::{LaunchTraceRecord, StageOutcome};
use super::report::{correlate, report_for_agent_run, report_for_launch_attempt, TraceVerdict};
use super::stages::{PRE_COMMIT_STAGES, RUN_ENDED_STAGE, SWEEP_STAGE};

const ATTEMPT: &str = "attempt-1";
const RUN: &str = "run-1";

fn record(event: &str, millisecond: u32, extra: serde_json::Value) -> LaunchTraceRecord {
    let mut value = json!({
        "event": event,
        "timestamp": format!("2026-08-31T08:45:{:02}.{:03}Z", millisecond / 1000, millisecond % 1000),
        "provider": "claude",
        "projectId": "project-1",
    });
    let object = value.as_object_mut().expect("a record object");
    for (key, entry) in extra.as_object().expect("extra fields") {
        object.insert(key.clone(), entry.clone());
    }
    LaunchTraceRecord::from_value(&value).expect("a parsable record")
}

fn attempt_stage(event: &str, millisecond: u32) -> LaunchTraceRecord {
    record(event, millisecond, json!({"launchAttemptId": ATTEMPT}))
}

fn run_stage(event: &str, millisecond: u32) -> LaunchTraceRecord {
    record(event, millisecond, json!({"agentRunId": RUN}))
}

fn commit(millisecond: u32) -> LaunchTraceRecord {
    record(
        "launch-transaction-committed",
        millisecond,
        json!({"launchAttemptId": ATTEMPT, "agentRunId": RUN}),
    )
}

fn complete_trace() -> Vec<LaunchTraceRecord> {
    let mut records: Vec<LaunchTraceRecord> = PRE_COMMIT_STAGES
        .iter()
        .enumerate()
        .map(|(index, stage)| attempt_stage(stage, index as u32 * 10))
        .collect();
    records.push(commit(100));
    records.push(run_stage("wake-up-published", 110));
    records.push(run_stage("wake-up-received", 120));
    records.push(run_stage("durable-event-reread", 130));
    records.push(run_stage("graphql-frame-delivered", 140));
    records.push(run_stage("graphql-frame-received", 150));
    records.push(run_stage("apollo-run-applied", 160));
    records.push(run_stage("workspace-render-committed", 200));
    records
}

#[test]
fn a_launch_that_reaches_the_workspace_reports_as_completed() {
    let report = report_for_agent_run(&complete_trace(), RUN);

    assert_eq!(report.verdict, TraceVerdict::Completed);
    assert_eq!(
        report.last_stage_reached.as_deref(),
        Some("workspace-render-committed")
    );
    assert_eq!(report.total_elapsed_ms, Some(200));
    assert_eq!(report.launch_attempt_id.as_deref(), Some(ATTEMPT));
    assert_eq!(report.provider.as_deref(), Some("claude"));
}

#[test]
fn the_report_carries_the_elapsed_time_between_consecutive_stages() {
    let report = report_for_agent_run(&complete_trace(), RUN);

    assert_eq!(report.stages[0].elapsed_from_previous_ms, None);
    assert_eq!(report.stages[1].elapsed_from_previous_ms, Some(10));
    let render = report.stages.last().expect("the workspace render");
    assert_eq!(render.elapsed_from_previous_ms, Some(40));
}

#[test]
fn every_pre_commit_stage_can_refuse_and_is_named_as_the_refusal() {
    for (index, stage) in PRE_COMMIT_STAGES.iter().enumerate() {
        let mut records: Vec<LaunchTraceRecord> = PRE_COMMIT_STAGES[..index]
            .iter()
            .enumerate()
            .map(|(earlier, stage)| attempt_stage(stage, earlier as u32 * 10))
            .collect();
        records.push(record(
            stage,
            index as u32 * 10,
            json!({"launchAttemptId": ATTEMPT, "refusalReason": "policy_rejected"}),
        ));

        let report = report_for_launch_attempt(&records, ATTEMPT);

        assert_eq!(
            report.verdict,
            TraceVerdict::Refused {
                stage: (*stage).to_owned(),
                reason: Some("policy_rejected".to_owned()),
            },
            "{stage} must report as the refusal"
        );
        assert_eq!(report.last_stage_reached.as_deref(), Some(*stage));
    }
}

#[test]
fn a_trace_that_stops_without_refusing_reports_as_incomplete() {
    let records = vec![
        attempt_stage("launch-requested", 0),
        attempt_stage("launch-policy-evaluated", 5),
        attempt_stage("launch-executable-resolved", 3_000),
    ];

    let report = report_for_launch_attempt(&records, ATTEMPT);

    assert_eq!(
        report.verdict,
        TraceVerdict::Incomplete {
            last_stage: "launch-executable-resolved".to_owned()
        }
    );
    assert_eq!(
        report.stages[2].elapsed_from_previous_ms,
        Some(2_995),
        "a stall must be visible as elapsed time"
    );
}

#[test]
fn a_launch_that_never_committed_still_reports_under_its_attempt_identity() {
    let records = vec![
        attempt_stage("launch-requested", 0),
        attempt_stage("launch-policy-evaluated", 4),
    ];

    let report = report_for_launch_attempt(&records, ATTEMPT);

    assert_eq!(report.agent_run_id, None);
    assert_eq!(report.stages.len(), 2);
    assert!(matches!(report.verdict, TraceVerdict::Incomplete { .. }));
}

#[test]
fn records_that_arrive_out_of_order_are_reported_in_path_order() {
    let mut records = complete_trace();
    records.reverse();

    let report = report_for_agent_run(&records, RUN);

    let reported: Vec<&str> = report
        .stages
        .iter()
        .map(|stage| stage.event.as_str())
        .collect();
    assert_eq!(reported.first(), Some(&"launch-requested"));
    assert_eq!(reported.last(), Some(&"workspace-render-committed"));
    assert_eq!(report.verdict, TraceVerdict::Completed);
}

#[test]
fn the_commit_stage_joins_the_pre_commit_and_post_commit_halves_into_one_report() {
    let reports = correlate(&complete_trace());

    assert_eq!(reports.len(), 1, "one launch must read as one report");
    assert_eq!(reports[0].agent_run_id.as_deref(), Some(RUN));
    assert_eq!(reports[0].launch_attempt_id.as_deref(), Some(ATTEMPT));
}

#[test]
fn each_end_of_life_origin_is_appended_to_the_run_it_ended() {
    for origin in [
        "person_stop_action",
        "agent_self_termination",
        "workflow_decision",
        "provider_process_exit",
        "runtime_liveness_sweep",
        "unattributed",
    ] {
        let mut records = complete_trace();
        records.push(record(
            RUN_ENDED_STAGE,
            300,
            json!({"agentRunId": RUN, "endOfLifeOrigin": origin}),
        ));

        let report = report_for_agent_run(&records, RUN);

        let end = report.end_of_life.expect("an end-of-life record");
        assert_eq!(end.origin, origin);
    }
}

#[test]
fn a_provider_exit_keeps_its_exit_code_and_signal() {
    let mut records = complete_trace();
    records.push(record(
        RUN_ENDED_STAGE,
        300,
        json!({
            "agentRunId": RUN,
            "endOfLifeOrigin": "provider_process_exit",
            "exitCode": 127,
            "terminatingSignal": serde_json::Value::Null,
        }),
    ));

    let end = report_for_agent_run(&records, RUN)
        .end_of_life
        .expect("an end-of-life record");

    assert_eq!(end.exit_code, Some(127));
    assert_eq!(end.terminating_signal, None);
}

#[test]
fn a_sweep_reports_how_many_runs_it_ended() {
    let mut records = complete_trace();
    records.push(record(
        SWEEP_STAGE,
        300,
        json!({
            "agentRunId": RUN,
            "endOfLifeOrigin": "runtime_liveness_sweep",
            "sweptRunCount": 21,
        }),
    ));

    let end = report_for_agent_run(&records, RUN)
        .end_of_life
        .expect("a sweep record");

    assert_eq!(end.swept_run_count, Some(21));
    assert_eq!(end.origin, "runtime_liveness_sweep");
}

#[test]
fn an_end_without_a_recorded_origin_reads_as_unattributed() {
    let mut records = complete_trace();
    records.push(record(RUN_ENDED_STAGE, 300, json!({"agentRunId": RUN})));

    let end = report_for_agent_run(&records, RUN)
        .end_of_life
        .expect("an end-of-life record");

    assert_eq!(end.origin, "unattributed");
}

#[test]
fn end_of_life_records_stay_out_of_the_path() {
    let mut records = complete_trace();
    records.push(record(
        RUN_ENDED_STAGE,
        300,
        json!({"agentRunId": RUN, "endOfLifeOrigin": "person_stop_action"}),
    ));

    let report = report_for_agent_run(&records, RUN);

    assert_eq!(
        report.last_stage_reached.as_deref(),
        Some("workspace-render-committed"),
        "a run's end must not become the last stage of its launch path"
    );
    assert!(report
        .stages
        .iter()
        .all(|stage| stage.event != RUN_ENDED_STAGE));
}

#[test]
fn separate_launches_read_as_separate_reports_in_start_order() {
    let mut records = vec![
        record(
            "launch-requested",
            500,
            json!({"launchAttemptId": "second"}),
        ),
        record("launch-requested", 0, json!({"launchAttemptId": "first"})),
    ];
    records.push(record(
        "launch-policy-evaluated",
        10,
        json!({"launchAttemptId": "first"}),
    ));

    let reports = correlate(&records);

    assert_eq!(reports.len(), 2);
    assert_eq!(reports[0].launch_attempt_id.as_deref(), Some("first"));
    assert_eq!(reports[1].launch_attempt_id.as_deref(), Some("second"));
}

#[test]
fn an_unknown_identity_reports_as_empty_rather_than_failing() {
    let report = report_for_agent_run(&complete_trace(), "no-such-run");

    assert_eq!(report.verdict, TraceVerdict::Empty);
    assert!(report.stages.is_empty());
    assert_eq!(report.last_stage_reached, None);
}

#[test]
fn a_stage_records_whether_it_admitted_or_refused() {
    let records = vec![attempt_stage("launch-requested", 0)];

    let report = report_for_launch_attempt(&records, ATTEMPT);

    assert_eq!(report.stages[0].outcome, StageOutcome::Admitted);
    assert_eq!(report.stages[0].refusal_reason, None);
}
