//! The reader's cases. It is pure, so it carries the heaviest test burden.

use serde_json::json;

use super::record::{LaunchTraceRecord, StageOutcome};
use super::report::{correlate, report_for_agent_run, report_for_launch_attempt, TraceVerdict};
use super::stages::{attempt_keyed_stages, path_stages, RUN_ENDED_STAGE, SWEEP_STAGE};

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

fn join(millisecond: u32) -> LaunchTraceRecord {
    record(
        "launch-attempt-committed",
        millisecond,
        json!({"launchAttemptId": ATTEMPT, "agentRunId": RUN}),
    )
}

/// One launch that travelled the whole path, ten milliseconds per stage.
fn complete_trace() -> Vec<LaunchTraceRecord> {
    path_stages()
        .enumerate()
        .map(|(index, stage)| {
            let at = index as u32 * 10;
            match stage {
                "launch-attempt-committed" => join(at),
                "launch-transaction-committed" => run_stage(stage, at),
                stage if attempt_keyed_stages().any(|keyed| keyed == stage) => {
                    attempt_stage(stage, at)
                }
                stage => run_stage(stage, at),
            }
        })
        .collect()
}

#[test]
fn a_launch_that_reaches_the_workspace_reports_as_completed() {
    let report = report_for_agent_run(&complete_trace(), RUN);

    assert_eq!(report.verdict, TraceVerdict::Completed);
    assert_eq!(
        report.last_stage_reached.as_deref(),
        Some("workspace-render-committed")
    );
    assert_eq!(
        report.total_elapsed_ms,
        Some((path_stages().count() as i64 - 1) * 10)
    );
    assert_eq!(report.launch_attempt_id.as_deref(), Some(ATTEMPT));
    assert_eq!(report.provider.as_deref(), Some("claude"));
}

#[test]
fn the_report_carries_the_elapsed_time_between_consecutive_stages() {
    let report = report_for_agent_run(&complete_trace(), RUN);

    assert_eq!(report.stages[0].elapsed_from_previous_ms, None);
    assert_eq!(report.stages[1].elapsed_from_previous_ms, Some(10));
    let render = report.stages.last().expect("the workspace render");
    assert_eq!(render.elapsed_from_previous_ms, Some(10));
}

#[test]
fn every_attempt_keyed_stage_can_refuse_and_is_named_as_the_refusal() {
    let keyed: Vec<&str> = attempt_keyed_stages().collect();
    for (index, stage) in keyed.iter().enumerate() {
        let mut records: Vec<LaunchTraceRecord> = keyed[..index]
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
    // The executable stage is where a hanging version probe would stall.

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

#[test]
fn the_agents_own_termination_is_not_displaced_by_the_shutdown_it_caused() {
    let mut records = complete_trace();
    records.push(record(
        RUN_ENDED_STAGE,
        300,
        json!({"agentRunId": RUN, "endOfLifeOrigin": "agent_self_termination"}),
    ));
    records.push(record(
        RUN_ENDED_STAGE,
        400,
        json!({"agentRunId": RUN, "endOfLifeOrigin": "person_stop_action"}),
    ));

    let end = report_for_agent_run(&records, RUN)
        .end_of_life
        .expect("an end-of-life record");

    assert_eq!(
        end.origin, "agent_self_termination",
        "the first thing that ended the run is what ended it"
    );
}

#[test]
fn an_unattributed_record_never_displaces_an_attributed_one() {
    let mut records = complete_trace();
    records.push(record(
        RUN_ENDED_STAGE,
        300,
        json!({"agentRunId": RUN, "endOfLifeOrigin": "provider_process_exit", "exitCode": 127}),
    ));
    records.push(record(
        RUN_ENDED_STAGE,
        400,
        json!({"agentRunId": RUN, "endOfLifeOrigin": "unattributed"}),
    ));

    let end = report_for_agent_run(&records, RUN)
        .end_of_life
        .expect("an end-of-life record");

    assert_eq!(end.origin, "provider_process_exit");
    assert_eq!(end.exit_code, Some(127));
}

#[test]
fn an_agent_run_claimed_twice_stays_with_the_launch_that_claimed_it_first() {
    let records = vec![
        record(
            "launch-attempt-committed",
            0,
            json!({"launchAttemptId": "first", "agentRunId": RUN}),
        ),
        record(
            "launch-attempt-committed",
            10,
            json!({"launchAttemptId": "second", "agentRunId": RUN}),
        ),
    ];

    let first = report_for_launch_attempt(&records, "first");

    assert_eq!(first.agent_run_id.as_deref(), Some(RUN));
    assert_eq!(first.stages.len(), 1);
    assert_eq!(
        first.stages[0].occurrences, 2,
        "both claims are counted, under the launch that claimed the run first"
    );
}

/// The launch-discovery commit record predates the trace and writes the launch
/// request identity under `launchAttemptId`. It is logged before the join
/// record, and a live development log read as two reports per launch because of
/// it. The join record is the pairing the reader trusts.
#[test]
fn a_commit_record_carrying_the_request_identity_does_not_split_the_launch_in_two() {
    let records = vec![
        attempt_stage("launch-requested", 0),
        attempt_stage("launch-authority-resolved", 5),
        record(
            "launch-transaction-committed",
            11,
            json!({"launchAttemptId": "e46a9a17-launch-request", "agentRunId": RUN}),
        ),
        record(
            "launch-attempt-committed",
            11,
            json!({"launchAttemptId": ATTEMPT, "agentRunId": RUN}),
        ),
        attempt_stage("launch-directory-preflighted", 188),
        attempt_stage("prompt-delivered", 714),
        run_stage("wake-up-published", 11),
        run_stage("workspace-render-committed", 97),
    ];

    let reports = correlate(&records);

    assert_eq!(reports.len(), 1, "one launch must read as one report");
    let report = &reports[0];
    assert_eq!(report.launch_attempt_id.as_deref(), Some(ATTEMPT));
    assert_eq!(report.agent_run_id.as_deref(), Some(RUN));
    let reported: Vec<&str> = report
        .stages
        .iter()
        .map(|stage| stage.event.as_str())
        .collect();
    assert_eq!(reported.first(), Some(&"launch-requested"));
    assert!(reported.contains(&"launch-transaction-committed"));
    assert!(reported.contains(&"prompt-delivered"));
    assert_eq!(reported.last(), Some(&"workspace-render-committed"));
}

#[test]
fn the_completed_verdict_reports_the_full_chronological_span() {
    let records = vec![
        attempt_stage("launch-requested", 149),
        record(
            "launch-attempt-committed",
            200,
            json!({"launchAttemptId": ATTEMPT, "agentRunId": RUN}),
        ),
        attempt_stage("prompt-delivered", 52_690),
        run_stage("workspace-render-committed", 246),
    ];

    let report = report_for_agent_run(&records, RUN);
    let text = super::render::render(&report);

    assert_eq!(report.total_elapsed_ms, Some(52_541));
    assert!(text.contains("verdict: completed in 52541 ms"), "{text}");
}

/// The visibility stages fire again on every status event for as long as the
/// run lives. The path is the first time each stage was reached and the repeats
/// are counted rather than added as rows. The total still spans every record.
#[test]
fn a_stage_reached_repeatedly_is_reported_once_at_its_first_reach_with_its_repeat_count() {
    let mut records = complete_trace();
    let later_rereads = [5_000, 9_000, 30_000];
    for at in later_rereads {
        records.push(run_stage("durable-event-reread", at));
        records.push(run_stage("workspace-render-committed", at + 100));
    }

    let report = report_for_agent_run(&records, RUN);

    let reread = report
        .stages
        .iter()
        .find(|stage| stage.event == "durable-event-reread")
        .expect("the reread stage");
    let first_reach = complete_trace()
        .iter()
        .find(|record| record.event == "durable-event-reread")
        .map(|record| record.timestamp)
        .expect("the first reread");
    assert_eq!(reread.timestamp, first_reach);
    assert_eq!(reread.occurrences, 4);
    assert_eq!(
        report
            .stages
            .iter()
            .filter(|stage| stage.event == "durable-event-reread")
            .count(),
        1
    );
    assert_eq!(report.verdict, TraceVerdict::Completed);
    assert_eq!(
        report.total_elapsed_ms,
        Some(30_100),
        "the total spans the raw records even though repeated rows collapse"
    );
}
