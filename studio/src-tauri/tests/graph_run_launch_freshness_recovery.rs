//! Launch freshness across a service reopen and under a concurrent press and
//! advance: future attempts resolve the current binding, prepared attempts
//! replay their own material, and no child launches twice.

mod common;

use std::sync::Arc;

use common::graph_run_campaign_steps::*;
use common::graph_run_fixture::*;
use common::submitted_launch_authority::launch_service;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, TASK_ID};
use ticketry_agent_execution::graph::ExecutionMode;
use ticketry_terminal::TerminalLaunchBoundary;

#[tokio::test]
async fn reopened_service_resolves_current_binding_and_replays_prepared_material() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    arm_parallel_behind_external(&database, &service(&database)).await;
    run(
        &database,
        &format!(
            "{}; UPDATE worktracker_launchbinding SET model_id='{FRESH_MODEL}'; \
         UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'",
            codex_model(FRESH_MODEL, "fresh-model")
        ),
    )
    .await;

    // The first attempt commits its claim and material, then the process
    // "stops" before the runtime starts it and before the second child.
    let stopping = launch_service(database.clone(), Arc::new(Runtime::default()))
        .stopping_once_at(TerminalLaunchBoundary::EffectPrepared);
    let stopped = service_with_terminal(&database, stopping)
        .advance(TASK_ID)
        .await
        .unwrap_err();
    assert_eq!(stopped.code_str(), "terminal_launch_injected_stop");
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        1
    );
    let prepared_child = claim_runs(&database).await.into_keys().next().unwrap();
    let pending_child = if prepared_child == CHILD_A {
        CHILD_B
    } else {
        CHILD_A
    };
    let prepared = prepared_launch(&database, &prepared_child).await;
    let prepared_claim = claim_tuple(&database, &prepared_child).await;
    assert_eq!(prepared.model.as_deref(), Some("fresh-model"));

    run(&database, &format!(
        "{}; UPDATE worktracker_launchbinding SET model_id='{LATER_MODEL}', prompt='Reopened policy.'",
        codex_model(LATER_MODEL, "later-model")
    ))
    .await;
    // Reopen: a brand-new terminal launch service and Graph Run service.
    let terminal = launch_service(database.clone(), Arc::new(Runtime::default()));
    let reopened = service_with_terminal(&database, terminal.clone());
    terminal.reconcile().await.unwrap();
    let advanced = reopened.advance(TASK_ID).await.unwrap();
    assert_eq!(
        advanced
            .launched
            .iter()
            .map(|c| c.task_id.as_str())
            .collect::<Vec<_>>(),
        [pending_child]
    );

    let fresh = prepared_launch(&database, pending_child).await;
    assert_eq!(fresh.model.as_deref(), Some("later-model"));
    assert!(fresh
        .prompt
        .starts_with("Selected workflow prompt:\nReopened policy."));
    // Replay kept the prepared attempt's material, Agent Run and claim.
    assert_eq!(prepared_launch(&database, &prepared_child).await, prepared);
    assert_eq!(
        claim_tuple(&database, &prepared_child).await,
        prepared_claim
    );
    assert_eq!(
        scalar_where(
            &database,
            "terminal_launch_material",
            "task_id",
            &prepared_child
        )
        .await,
        1
    );
    assert_eq!(
        scalar_where(&database, "agent_runs", "issue_id", &prepared_child).await,
        1
    );
    assert_eq!(
        scalar_where(
            &database,
            "agent_terminal_sessions",
            "agent_run_id",
            &prepared.agent_run_id
        )
        .await,
        1
    );
    assert!(reopened.advance(TASK_ID).await.unwrap().launched.is_empty());
    assert_claims_match_material(&database, &[CHILD_A, CHILD_B]).await;
}

#[tokio::test]
async fn concurrent_press_and_advance_launch_each_child_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    let service = service(&database);
    arm_parallel_behind_external(&database, &service).await;
    run(
        &database,
        &format!("UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'"),
    )
    .await;
    let runs_before = scalar(&database, "SELECT COUNT(*) FROM agent_runs").await;

    let (pressed, advanced) = tokio::join!(
        service.create_or_press(request(ExecutionMode::Parallel, None)),
        service.advance(TASK_ID)
    );
    let mut launched = pressed.unwrap().launched;
    launched.extend(advanced.unwrap().launched);
    let mut ids = launched
        .iter()
        .map(|c| c.task_id.as_str())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, [CHILD_A, CHILD_B]);
    for child in [CHILD_A, CHILD_B] {
        assert_eq!(
            scalar_where(&database, "agent_runs", "issue_id", child).await,
            1
        );
        assert_eq!(
            scalar_where(&database, "terminal_launch_material", "task_id", child).await,
            1
        );
    }
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM agent_runs").await,
        runs_before + 2
    );
    let orphans = format!(
        "SELECT COUNT(*) FROM agent_runs WHERE issue_id IN ('{CHILD_A}','{CHILD_B}') \
         AND id NOT IN (SELECT agent_run_id FROM launched_tasks)"
    );
    assert_eq!(scalar(&database, &orphans).await, 0);
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        2
    );
    assert_claims_match_material(&database, &[CHILD_A, CHILD_B]).await;
}
