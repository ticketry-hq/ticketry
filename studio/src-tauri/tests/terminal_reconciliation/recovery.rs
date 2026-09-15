use super::*;
use sea_orm::{ConnectionTrait, TransactionTrait};
use ticketry_runs::{LaunchOutcome, RunsServices};

#[tokio::test]
async fn running_orphan_maps_back_to_its_ticket_without_cleanup_or_a_new_run() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let run_id = "recover-mapped-run";
    insert_run(&database, run_id, "exited", true).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(run_id, [CleanupRuntimeObservation::Running]);
    runtime.set_inventory([owned_inventory(run_id, "legacy-runtime", true)]);
    let reconciler = service(database.clone(), runtime);
    let before = agent_run::Entity::find().count(&database).await.unwrap();

    let report = reconciler.reconcile().await.unwrap();
    assert_eq!(
        report.unrecorded[0].decision,
        UnrecordedRuntimeDecision::Adopted
    );
    let terminal = session::Entity::find_by_id(run_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(terminal.task_id, TASK_ID.replace('-', ""));
    assert_eq!(terminal.project_id, PROJECT_ID.replace('-', ""));
    assert!(!terminal.runtime_cleanup_pending);
    assert!(terminal.terminated_at.is_none());
    assert_eq!(terminal_events(&database, run_id).await, 1);
    assert_eq!(
        agent_run::Entity::find_by_id(run_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .status,
        "exited",
        "recover the terminal without rewriting run history"
    );
    reconciler.reconcile().await.unwrap();
    assert_eq!(
        agent_run::Entity::find().count(&database).await.unwrap(),
        before
    );
    assert_eq!(
        cleanup_effect::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );
    assert_eq!(terminal_events(&database, run_id).await, 1);
}

#[tokio::test]
async fn surviving_launch_is_attachable_before_its_lease_expires() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::default());
    launch_service(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::TmuxCreated)
        .create(launch_request("recover-before-lease-expiry"))
        .await
        .unwrap_err();
    let effect = launch_effect::Entity::find()
        .filter(launch_effect::Column::RequestId.eq("recover-before-lease-expiry"))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    runtime.set_inventory([owned_inventory(
        &effect.agent_run_id,
        "reconciliation-runtime",
        false,
    )]);
    let reconciler = service(database.clone(), runtime);
    let report = reconciler.reconcile().await.unwrap();
    assert_eq!(report.launches.applied, 0, "do not steal the launch lease");
    assert_eq!(
        report.unrecorded[0].decision,
        UnrecordedRuntimeDecision::Adopted
    );
    let terminal = session::Entity::find_by_id(&effect.agent_run_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(terminal.task_id, TASK_ID.replace('-', ""));
    assert!(!terminal.runtime_cleanup_pending);
    let unchanged = launch_effect::Entity::find_by_id(&effect.effect_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(unchanged.lease_owner, effect.lease_owner);
    assert_eq!(unchanged.attempt_count, 1);
    launch_effect::Entity::update_many()
        .col_expr(
            launch_effect::Column::LeaseExpiresAt,
            Expr::value(Some("2000-01-01T00:00:00Z".to_owned())),
        )
        .filter(launch_effect::Column::EffectId.eq(&effect.effect_id))
        .exec(&database)
        .await
        .unwrap();
    assert_eq!(reconciler.reconcile().await.unwrap().launches.applied, 1);
    assert_eq!(
        session::Entity::find_by_id(&effect.agent_run_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .tmux_session_name,
        terminal.tmux_session_name
    );
}

#[tokio::test]
async fn launch_settlement_waits_for_a_concurrent_writer_before_reading() {
    let harness = TerminalLifecycleHarness::start().await;
    let database =
        ticketry_work_management::open_for_commands(&harness.data_directory().join("state.db"))
            .await
            .unwrap();
    let runtime = Arc::new(ScriptedRuntime::default());
    launch_service(database.clone(), runtime)
        .stopping_once_at(TerminalLaunchBoundary::TmuxCreated)
        .create(launch_request("settlement-contention"))
        .await
        .unwrap_err();
    let effect = launch_effect::Entity::find()
        .filter(launch_effect::Column::RequestId.eq("settlement-contention"))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let writer = database.begin().await.unwrap();
    writer
        .execute_unprepared("UPDATE agent_runs SET status = status")
        .await
        .unwrap();
    let runs = RunsServices::new(database.clone());
    let outcome = runs.effects().record_outcome(
        &effect.effect_id,
        effect.lease_owner.as_deref().unwrap(),
        LaunchOutcome::Applied {
            runtime_evidence: serde_json::json!({"verified": true}),
        },
    );
    tokio::pin!(outcome);
    tokio::select! {
        result = &mut outcome => panic!("settlement must wait for the writer, got {result:?}"),
        _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {}
    }
    writer.commit().await.unwrap();
    assert!(outcome.await.unwrap().settled);
}
