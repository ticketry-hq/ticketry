//! Launch executable diagnostics must describe the provider process, not tmux.

mod common;

use std::collections::BTreeMap;

use common::execution_fixture as fixture;
use common::execution_harness::ExecutionHarness;
use serde_json::Value;

#[tokio::test]
async fn each_launch_records_one_provider_executable_after_directory_preflight() {
    let log_directory = tempfile::tempdir().expect("create launch trace log directory");
    let log_path = log_directory.path().join("ticketry.log");
    ticketry_diagnostics::configure_process_file_log(
        false,
        log_directory.path(),
        Some(log_path.clone()),
    );

    let mut harness = ExecutionHarness::start().await;
    harness.execute(fixture::PARALLEL_CAMPAIGN_ROOT).await;
    assert_eq!(harness.live_runtimes().len(), 2);
    harness.shutdown().await;

    let records = launch_records(&log_path);
    let executable_records = records
        .iter()
        .filter(|record| record["event"] == ticketry_diagnostics::EXECUTABLE_RESOLVED)
        .collect::<Vec<_>>();
    assert_eq!(
        executable_records.len(),
        2,
        "one executable-resolution record must describe each launched provider: {executable_records:#?}"
    );

    let mut executable_by_attempt = BTreeMap::new();
    for record in executable_records {
        assert_eq!(record["provider"], "codex", "{record}");
        assert_eq!(record["executableName"], "codex", "{record}");
        assert!(
            record["candidatePath"]
                .as_str()
                .is_some_and(|path| path.ends_with("/approved-bin/codex")),
            "{record}"
        );
        let attempt_id = record["launchAttemptId"]
            .as_str()
            .expect("executable resolution has a launch attempt");
        assert!(
            executable_by_attempt
                .insert(attempt_id.to_owned(), record)
                .is_none(),
            "launch attempt {attempt_id} recorded executable resolution more than once"
        );
    }
    assert_eq!(executable_by_attempt.len(), 2);

    for attempt_id in executable_by_attempt.keys() {
        let directory_position = stage_position(
            &records,
            attempt_id,
            ticketry_diagnostics::DIRECTORY_PREFLIGHTED,
        );
        let executable_position = stage_position(
            &records,
            attempt_id,
            ticketry_diagnostics::EXECUTABLE_RESOLVED,
        );
        assert!(
            directory_position < executable_position,
            "attempt {attempt_id} resolved its executable before directory preflight"
        );
    }
}

fn launch_records(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .expect("read launch trace log")
        .lines()
        .filter_map(|line| line.split_once("launch-discovery ").map(|(_, json)| json))
        .map(|json| serde_json::from_str(json).expect("parse launch trace record"))
        .collect()
}

fn stage_position(records: &[Value], attempt_id: &str, stage: &str) -> usize {
    records
        .iter()
        .position(|record| {
            record["launchAttemptId"] == attempt_id && record["event"].as_str() == Some(stage)
        })
        .unwrap_or_else(|| panic!("attempt {attempt_id} did not record {stage}"))
}
