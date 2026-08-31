use common::terminal_lifecycle_harness::TerminalLifecycleHarness;
use muxed_studio_lib::tmux_adapter::{
    ApprovedArgv, CreateOutcome, CreateSession, InventoryConflictKind, InventoryEntry, KillOutcome,
    RuntimeIdentity, RuntimeObservation, TerminalGeometry, TmuxAdapter,
};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use ticketry_tool_discovery::SupportedTool;

mod common;

fn identity(run_id: &str) -> RuntimeIdentity {
    RuntimeIdentity::new(run_id, "tmux-characterization").unwrap()
}

fn request(harness: &TerminalLifecycleHarness, run_id: &str) -> CreateSession {
    CreateSession {
        identity: identity(run_id),
        geometry: TerminalGeometry::new(93, 31).unwrap(),
        command: ApprovedArgv::for_tool(
            SupportedTool::Codex,
            std::iter::empty::<String>(),
            harness.data_directory().to_path_buf(),
            BTreeMap::new(),
        )
        .unwrap(),
    }
}

#[tokio::test]
async fn creates_verifies_inventories_observes_and_kills_owned_sessions() {
    let harness = TerminalLifecycleHarness::start().await;
    harness
        .tmux
        .create_hosted("sentinel", "while :; do sleep 1; done");
    let adapter = TmuxAdapter::discover().unwrap();
    let create = request(&harness, "adapter-owned");

    assert_eq!(
        adapter.observe(&create.identity),
        RuntimeObservation::Missing
    );
    assert_eq!(adapter.create(&create).unwrap(), CreateOutcome::Created);
    assert!(matches!(
        adapter.create(&create).unwrap(),
        CreateOutcome::Existing(RuntimeObservation::Running)
            | CreateOutcome::Existing(RuntimeObservation::Exited { .. })
    ));

    let deadline = Instant::now() + Duration::from_secs(3);
    let exited = loop {
        let observed = adapter.observe(&create.identity);
        if matches!(observed, RuntimeObservation::Exited { .. }) {
            break observed;
        }
        assert!(Instant::now() < deadline, "hosted command did not exit");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(exited, RuntimeObservation::Exited { exit_code: Some(0) });

    let inventory = adapter.inventory().unwrap();
    assert!(inventory.iter().any(|row| {
        row.agent_run_id == "adapter-owned"
            && row.runtime_namespace == "tmux-characterization"
            && !row.running
            && row.exit_code == Some(0)
    }));

    assert_eq!(
        adapter.kill_verified(&create.identity).unwrap(),
        KillOutcome::Killed
    );
    assert_eq!(
        adapter.observe(&create.identity),
        RuntimeObservation::Missing
    );
    assert_eq!(
        adapter.kill_verified(&create.identity).unwrap(),
        KillOutcome::AlreadyMissing
    );
}

#[tokio::test]
async fn creates_a_provider_command_larger_than_tmuxs_control_message_limit() {
    let harness = TerminalLifecycleHarness::start().await;
    let adapter = TmuxAdapter::discover().unwrap();
    let create = CreateSession {
        identity: identity("adapter-oversized-command"),
        geometry: TerminalGeometry::new(93, 31).unwrap(),
        command: ApprovedArgv::for_tool(
            SupportedTool::Codex,
            ["large task context ".repeat(1_500)],
            harness.data_directory().to_path_buf(),
            BTreeMap::new(),
        )
        .unwrap(),
    };

    assert_eq!(adapter.create(&create).unwrap(), CreateOutcome::Created);

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match adapter.observe(&create.identity) {
            RuntimeObservation::Exited { exit_code } => {
                assert_eq!(exit_code, Some(0));
                break;
            }
            observed => {
                assert!(
                    Instant::now() < deadline,
                    "oversized hosted command did not exit: {observed:?}"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
    }
}

#[tokio::test]
async fn distinguishes_foreign_ambiguous_and_unavailable_runtime_state() {
    let harness = TerminalLifecycleHarness::start().await;
    harness
        .tmux
        .create_hosted("sentinel", "while :; do sleep 1; done");
    let adapter = TmuxAdapter::discover().unwrap();

    harness
        .tmux
        .create_hosted("foreign", "while :; do sleep 1; done");
    harness
        .tmux
        .set_session_option("foreign", "@pt-owner", "someone-else");
    assert_eq!(
        adapter.observe(&identity("foreign")),
        RuntimeObservation::Foreign
    );
    assert!(matches!(
        adapter.kill_verified(&identity("foreign")).unwrap(),
        KillOutcome::Refused(RuntimeObservation::Foreign)
    ));
    assert!(harness.tmux.has_agent_run("foreign"));

    harness
        .tmux
        .create_hosted("ambiguous", "while :; do sleep 1; done");
    harness.tmux.add_window("ambiguous");
    assert_eq!(
        adapter.observe(&identity("ambiguous")),
        RuntimeObservation::Ambiguous
    );
    assert!(matches!(
        adapter.kill_verified(&identity("ambiguous")).unwrap(),
        KillOutcome::Refused(RuntimeObservation::Ambiguous)
    ));

    let inventory = adapter.classified_inventory().unwrap();
    assert!(inventory.iter().any(|entry| matches!(
        entry,
        InventoryEntry::Conflict {
            kind: InventoryConflictKind::Foreign,
            ..
        }
    )));
    assert!(inventory.iter().any(|entry| matches!(
        entry,
        InventoryEntry::Conflict {
            kind: InventoryConflictKind::Ambiguous,
            ..
        }
    )));
    let diagnostics = format!("{inventory:?}");
    assert!(!diagnostics.contains("pt-foreign"));
    assert!(!diagnostics.contains("pt-ambiguous"));

    let unavailable = RuntimeIdentity::new("unavailable", "tmux-characterization").unwrap();
    harness.tmux.stop_server();
    std::fs::remove_dir_all(&harness.tmux.socket_dir).unwrap();
    std::fs::write(&harness.tmux.socket_dir, b"not a socket directory").unwrap();
    let observed = adapter.observe(&unavailable);
    assert!(
        matches!(observed, RuntimeObservation::Unavailable { .. }),
        "unexpected observation: {observed:?}"
    );
}
