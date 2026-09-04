//! One policy-driven launch, traced through to a timed report.
//!
//! The backend half runs through the desktop execution composition: a real
//! database, launch policy, `TerminalLaunchService`, disposable provider, and
//! private tmux server. Launch execution stops at prompt delivery; the report
//! also includes commit-time visibility records. Workspace render belongs to
//! the webview.

mod common;

use common::execution_fixture as fixture;
use common::execution_harness::ExecutionHarness;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_diagnostics::configure_process_file_log;
use ticketry_diagnostics::{
    self as trace, launch_trace_for_agent_run as report_for_agent_run,
    launch_trace_records_from_log as records_from_log, render_launch_trace as render, TraceVerdict,
};

#[test]
fn one_policy_launch_produces_one_ordered_timed_backend_report() {
    std::thread::Builder::new()
        .name("launch-trace-acceptance".to_owned())
        .stack_size(8 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a Tokio runtime")
                .block_on(assert_policy_launch_trace());
        })
        .expect("a test thread")
        .join()
        .expect("the launch-trace acceptance thread");
}

async fn assert_policy_launch_trace() {
    let directory = tempfile::tempdir().expect("a log directory");
    let log = configure_process_file_log(true, directory.path(), None);
    assert!(
        log.is_enabled(),
        "the probes need a log to write to for this assertion"
    );

    let mut harness = ExecutionHarness::start().await;
    let moved = harness.set_state(fixture::READY_FIRST, "Implement").await;
    assert_eq!(moved["ok"].as_bool(), Some(true), "{moved}");
    harness.restart().await;
    let database = harness.database().await;
    let agent_run_id: String = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT id AS agent_run_id FROM agent_runs WHERE issue_id='{}'",
                fixture::READY_FIRST
            ),
        ))
        .await
        .expect("read the launched run")
        .expect("the auto-start transition launches one run")
        .try_get("", "agent_run_id")
        .expect("read the Agent Run identity");
    harness.shutdown().await;

    let text = std::fs::read_to_string(log.path().expect("a log path")).expect("read the log");
    let records = records_from_log(&text);
    let report = report_for_agent_run(&records, &agent_run_id);

    assert_eq!(report.agent_run_id.as_deref(), Some(agent_run_id.as_str()));
    assert_eq!(
        report.provider.as_deref(),
        Some("codex"),
        "{}",
        render(&report)
    );
    assert_eq!(
        report.last_stage_reached.as_deref(),
        Some("wake-up-published"),
        "{}",
        render(&report)
    );
    assert!(
        matches!(report.verdict, TraceVerdict::Incomplete { .. }),
        "a backend launch is incomplete until the webview renders it: {}",
        render(&report)
    );

    let expected_stages = [
        trace::REQUESTED,
        trace::POLICY_EVALUATED,
        trace::COMMIT_STAGES[0],
        trace::JOIN_STAGE,
        trace::DIRECTORY_PREFLIGHTED,
        trace::EXECUTABLE_RESOLVED,
        trace::PROVIDER_VALIDATED,
        trace::ARGV_MATERIALISED,
        trace::RUNTIME_SPAWNED,
        trace::PROMPT_DELIVERED,
        trace::VISIBILITY_STAGES[0],
    ];
    let actual = report
        .stages
        .iter()
        .map(|stage| stage.event.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        actual,
        expected_stages,
        "the report must reflect the production policy-launch path: {}",
        render(&report)
    );
    assert!(
        report.stages.iter().all(|stage| stage.occurrences == 1),
        "each backend stage must be emitted exactly once per launch: {}",
        render(&report)
    );
    assert_eq!(
        report
            .stages
            .iter()
            .filter(|stage| stage.elapsed_from_previous_ms.is_none())
            .count(),
        1,
        "one wall-clock stage starts the timer and every other stage has a delta: {}",
        render(&report)
    );
    assert!(
        report.total_elapsed_ms.is_some(),
        "the report must time the launch"
    );

    for forbidden in ["--permission-mode", "--dangerously", "Authorization"] {
        assert!(
            !text.contains(forbidden),
            "the trace must stay safe to attach to a Work Item, found {forbidden}"
        );
    }
}
