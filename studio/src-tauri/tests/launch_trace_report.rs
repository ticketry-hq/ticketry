//! One launch attempt, traced through to a timed report.
//!
//! This is the Story's purpose asserted directly: a launch driven through the
//! probes produces a report that names the last stage reached and the elapsed
//! time between stages — for a launch that completes, and for one made to fail
//! at a chosen stage.
//!
//! The probes write to the process log and the reader reads it back, so the
//! record contract, the log, and the reader are exercised together rather than
//! separately.

use ticketry_diagnostics::configure_process_file_log;
use ticketry_diagnostics::launch_trace::{
    self as trace, records_from_log, render, report_for_launch_attempt, LaunchSurface, TraceVerdict,
};

/// Drives every stage of one launch, refusing at `refuse_at` when given.
async fn drive_launch(agent_run_id: &str, refuse_at: Option<&'static str>) -> String {
    trace::requested_by(LaunchSurface::RunNow, async {
        let attempt = trace::current().expect("an attempt");
        attempt.note(|facts| {
            facts.project_id = Some("project-1".to_owned());
            facts.work_item_id = Some("item-1".to_owned());
            facts.provider = Some("claude".to_owned());
            facts.model = Some("opus".to_owned());
            facts.scope = Some("task".to_owned());
        });
        for stage in [
            trace::stages::REQUESTED,
            trace::stages::POLICY_EVALUATED,
            trace::stages::AUTHORITY_RESOLVED,
        ] {
            if refuse_at == Some(stage) {
                trace::refused(stage, "refused_for_this_test").record();
                return attempt.id().to_owned();
            }
            trace::admitted(stage).record();
        }
        trace::attempt_committed(agent_run_id);
        for stage in [
            trace::stages::DIRECTORY_PREFLIGHTED,
            trace::stages::EXECUTABLE_RESOLVED,
            trace::stages::PROVIDER_VALIDATED,
            trace::stages::ARGV_MATERIALISED,
            trace::stages::RUNTIME_SPAWNED,
            trace::stages::PROMPT_DELIVERED,
        ] {
            if refuse_at == Some(stage) {
                trace::refused(stage, "refused_for_this_test").record();
                return attempt.id().to_owned();
            }
            trace::admitted(stage).record();
        }
        attempt.id().to_owned()
    })
    .await
}

#[tokio::test]
async fn one_development_launch_produces_one_ordered_timed_report() {
    let directory = tempfile::tempdir().expect("a log directory");
    let log = configure_process_file_log(true, directory.path(), None);
    assert!(
        log.is_enabled(),
        "the probes need a log to write to for this assertion"
    );

    let completed = drive_launch("run-completed", None).await;
    let refused = drive_launch("run-refused", Some(trace::stages::EXECUTABLE_RESOLVED)).await;

    let text = std::fs::read_to_string(log.path().expect("a log path")).expect("read the log");
    let records = records_from_log(&text);
    assert!(
        !records.is_empty(),
        "the probes must have written records: {text}"
    );

    // A launch that travelled the whole path.
    let report = report_for_launch_attempt(&records, &completed);
    assert_eq!(report.agent_run_id.as_deref(), Some("run-completed"));
    assert_eq!(report.provider.as_deref(), Some("claude"));
    assert_eq!(
        report.last_stage_reached.as_deref(),
        Some(trace::stages::PROMPT_DELIVERED),
        "the report must name the last stage reached: {}",
        render(&report)
    );
    assert!(
        matches!(report.verdict, TraceVerdict::Incomplete { .. }),
        "a launch with no workspace render has not completed its path: {:?}",
        report.verdict
    );
    assert_eq!(
        report.stages.first().map(|stage| stage.event.as_str()),
        Some(trace::stages::REQUESTED)
    );
    assert!(
        report
            .stages
            .iter()
            .skip(1)
            .all(|stage| stage.elapsed_from_previous_ms.is_some()),
        "every stage after the first must carry its elapsed time"
    );
    assert!(
        report.total_elapsed_ms.is_some(),
        "the report must time the whole launch"
    );

    // A launch made to fail at a chosen stage.
    let refused_report = report_for_launch_attempt(&records, &refused);
    assert_eq!(
        refused_report.verdict,
        TraceVerdict::Refused {
            stage: trace::stages::EXECUTABLE_RESOLVED.to_owned(),
            reason: Some("refused_for_this_test".to_owned()),
        },
        "{}",
        render(&refused_report)
    );
    assert_eq!(
        refused_report.last_stage_reached.as_deref(),
        Some(trace::stages::EXECUTABLE_RESOLVED)
    );
    assert!(
        refused_report
            .stages
            .iter()
            .any(|stage| stage.event == trace::stages::ARGV_MATERIALISED)
            .eq(&false),
        "a refused launch must not report stages it never reached"
    );

    // The two launches are separate reports, not one merged path.
    assert_ne!(report.launch_attempt_id, refused_report.launch_attempt_id);

    // The trace carries no prompt text, credentials, environment, or argv.
    for forbidden in ["--permission-mode", "--dangerously", "Authorization"] {
        assert!(
            !text.contains(forbidden),
            "the trace must stay safe to attach to a Work Item, found {forbidden}"
        );
    }
}
