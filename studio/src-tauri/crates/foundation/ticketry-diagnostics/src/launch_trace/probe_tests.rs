//! Record-contract assertions for the launch-path probes.

use serde_json::Value;

use super::attempt::{current, requested_by, LaunchAttempt};
use super::probe::{admitted, refused};
use super::stages;
use super::surface::LaunchSurface;

fn attempt_with_facts() -> LaunchAttempt {
    let attempt = LaunchAttempt::beginning_at(LaunchSurface::LaunchPicker);
    attempt.note(|facts| {
        facts.project_id = Some("project-1".to_owned());
        facts.work_item_id = Some("item-1".to_owned());
        facts.provider = Some("claude".to_owned());
        facts.model = Some("opus".to_owned());
        facts.reasoning = Some("high".to_owned());
        facts.scope = Some("task".to_owned());
    });
    attempt
}

#[test]
fn a_stage_record_carries_the_full_correlation_identity() {
    let attempt = attempt_with_facts();

    let value = admitted(stages::REQUESTED).build(&attempt).into_value();

    for field in [
        "event",
        "timestamp",
        "projectId",
        "agentRunId",
        "cursor",
        "connectionGeneration",
        "rendererInstance",
        "runtimeInstance",
        "launchAttemptId",
        "launchSurface",
        "provider",
        "model",
        "reasoning",
        "scope",
        "workItemId",
        "outcome",
        "refusalReason",
    ] {
        assert!(value.get(field).is_some(), "missing {field}: {value}");
    }
    assert_eq!(value["event"], stages::REQUESTED);
    assert_eq!(value["launchAttemptId"], attempt.id());
    assert_eq!(value["launchSurface"], "launch_picker");
    assert_eq!(value["provider"], "claude");
    assert_eq!(value["outcome"], "admitted");
}

#[test]
fn a_stage_that_cannot_know_a_field_writes_null_rather_than_omitting_it() {
    let attempt = LaunchAttempt::beginning_at(LaunchSurface::Unknown);

    let value = admitted(stages::REQUESTED).build(&attempt).into_value();

    assert_eq!(value["provider"], Value::Null);
    assert_eq!(value["model"], Value::Null);
    assert_eq!(value["workItemId"], Value::Null);
    assert_eq!(value["agentRunId"], Value::Null);
    assert_eq!(value["refusalReason"], Value::Null);
}

#[test]
fn a_refusal_records_its_structured_reason() {
    let attempt = attempt_with_facts();

    let value = refused(stages::ARGV_MATERIALISED, "approved_executable_unavailable")
        .build(&attempt)
        .into_value();

    assert_eq!(value["outcome"], "refused");
    assert_eq!(value["refusalReason"], "approved_executable_unavailable");
}

#[test]
fn stage_details_describe_shape_and_never_content() {
    let attempt = attempt_with_facts();

    let value = admitted(stages::ARGV_MATERIALISED)
        .with("argumentCount", 7)
        .with_optional("permissionMode", Some("auto"))
        .with_optional("resumeTarget", Option::<&str>::None)
        .build(&attempt)
        .into_value();

    assert_eq!(value["argumentCount"], 7);
    assert_eq!(value["permissionMode"], "auto");
    assert_eq!(value["resumeTarget"], Value::Null);
    let rendered = value.to_string();
    assert!(
        !rendered.contains("--dangerously-skip-permissions"),
        "argv values must not reach the trace: {rendered}"
    );
}

#[test]
fn later_facts_reach_the_stages_recorded_after_them() {
    let attempt = LaunchAttempt::beginning_at(LaunchSurface::RunNow);

    let before = admitted(stages::REQUESTED).build(&attempt).into_value();
    attempt.note(|facts| facts.provider = Some("claude".to_owned()));
    let after = admitted(stages::PROVIDER_VALIDATED)
        .build(&attempt)
        .into_value();

    assert_eq!(before["provider"], Value::Null);
    assert_eq!(after["provider"], "claude");
}

#[tokio::test]
async fn a_probe_outside_a_launch_records_nothing_and_does_not_fail() {
    assert!(current().is_none());
    admitted(stages::REQUESTED).record();
    refused(stages::POLICY_EVALUATED, "no attempt").record();
}

#[tokio::test]
async fn the_commit_record_carries_both_identities() {
    let value = requested_by(LaunchSurface::RunNow, async {
        let attempt = current().expect("an attempt");
        super::probe::committed("run-1")
            .build(&attempt)
            .into_value()
    })
    .await;

    assert_eq!(value["event"], "launch-attempt-committed");
    assert_eq!(value["agentRunId"], "run-1");
    assert!(value["launchAttemptId"].is_string());
}
