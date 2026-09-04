//! Wall-clock timing cases for path-ordered launch reports.

use serde_json::json;

use super::record::LaunchTraceRecord;
use super::report::report_for_agent_run;

const ATTEMPT: &str = "attempt-timing";
const RUN: &str = "run-timing";

fn record(event: &str, millisecond: u32, identities: serde_json::Value) -> LaunchTraceRecord {
    let mut value = json!({
        "event": event,
        "timestamp": format!("2026-08-31T08:45:00.{millisecond:03}Z"),
        "provider": "claude",
        "projectId": "project-1",
    });
    value
        .as_object_mut()
        .expect("a record object")
        .extend(identities.as_object().expect("identity fields").clone());
    LaunchTraceRecord::from_value(&value).expect("a parsable record")
}

fn attempt_stage(event: &str, millisecond: u32) -> LaunchTraceRecord {
    record(event, millisecond, json!({"launchAttemptId": ATTEMPT}))
}

fn run_stage(event: &str, millisecond: u32) -> LaunchTraceRecord {
    record(event, millisecond, json!({"agentRunId": RUN}))
}

fn joined_stage(event: &str, millisecond: u32) -> LaunchTraceRecord {
    record(
        event,
        millisecond,
        json!({"launchAttemptId": ATTEMPT, "agentRunId": RUN}),
    )
}

/// Rows stay in declared path order, while elapsed time follows wall-clock
/// order across commit-time wake-ups and recurring visibility stages.
#[test]
fn out_of_order_stages_keep_path_order_without_negative_elapsed_time() {
    let records = vec![
        attempt_stage("launch-requested", 0),
        run_stage("launch-transaction-committed", 30),
        joined_stage("launch-attempt-committed", 40),
        attempt_stage("launch-directory-preflighted", 50),
        attempt_stage("launch-executable-resolved", 43),
        attempt_stage("prompt-delivered", 100),
        run_stage("wake-up-published", 93),
        run_stage("durable-event-reread", 130),
        run_stage("durable-event-reread", 500),
        run_stage("graphql-frame-delivered", 140),
        run_stage("graphql-frame-received", 140),
        run_stage("apollo-run-applied", 160),
        run_stage("apollo-event-applied", 153),
        run_stage("apollo-event-applied", 170),
        run_stage("workspace-render-committed", 180),
    ];

    let report = report_for_agent_run(&records, RUN);
    let stage = |event| {
        report
            .stages
            .iter()
            .find(|stage| stage.event == event)
            .expect("the reported stage")
    };
    let position = |event| {
        report
            .stages
            .iter()
            .position(|stage| stage.event == event)
            .expect("the stage position")
    };

    assert!(position("launch-directory-preflighted") < position("launch-executable-resolved"));
    assert!(position("prompt-delivered") < position("wake-up-published"));
    assert!(position("apollo-run-applied") < position("apollo-event-applied"));
    assert_eq!(
        stage("launch-directory-preflighted").elapsed_from_previous_ms,
        Some(7)
    );
    assert_eq!(
        stage("launch-executable-resolved").elapsed_from_previous_ms,
        Some(3)
    );
    assert_eq!(
        stage("graphql-frame-received").elapsed_from_previous_ms,
        Some(0)
    );
    assert_eq!(
        stage("apollo-event-applied").elapsed_from_previous_ms,
        Some(13)
    );
    assert_eq!(
        stage("apollo-run-applied").elapsed_from_previous_ms,
        Some(7)
    );
    assert!(report
        .stages
        .iter()
        .filter_map(|stage| stage.elapsed_from_previous_ms)
        .all(|elapsed| elapsed >= 0));

    let text = super::render::render(&report);
    assert!(!text.contains("     -"), "{text}");
    assert!(text.contains("durable-event-reread ×2"), "{text}");
    assert!(text.contains("apollo-event-applied ×2"), "{text}");
}
