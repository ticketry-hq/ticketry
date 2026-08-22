mod common;

use std::sync::Arc;

use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, DOCUMENT_RUN_ID, MODULE_ID, PROJECT_ID, TASK_ID, TASK_RUN_ID,
};
use common::terminal_reconciliation_runtime::{
    service, ScriptedRuntime, StopCleanupPreparation, StopOnce,
};
use muxed_studio_lib::entities::{
    runs::{agent_run, launch_effect, status_event},
    terminals::{cleanup_effect, session},
};
use muxed_studio_lib::terminal_cleanup::{
    CleanupCause, CleanupRuntimeObservation, TerminalCleanupService,
};
use muxed_studio_lib::terminal_launch::{
    CreateTerminalSession, TerminalLaunchBoundary, TerminalLaunchKind, TerminalLaunchService,
};
use muxed_studio_lib::terminal_reconciliation::{
    ReconciliationCheckpoint, RecordedSessionDecision, UnrecordedRuntimeDecision,
};
use muxed_studio_lib::tmux_adapter::{InventoryConflictKind, InventoryEntry, OwnedSession};
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait,
    QueryFilter,
};

#[tokio::test]
async fn recorded_session_authority_table_converges_and_second_pass_is_stable() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_session(&database, "reconcile-exited", "running", false).await;
    insert_session(&database, "reconcile-lost", "running", false).await;
    insert_session(&database, "reconcile-tombstone", "exited", true).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(TASK_RUN_ID, [CleanupRuntimeObservation::Running]);
    runtime.set(DOCUMENT_RUN_ID, [CleanupRuntimeObservation::Unavailable]);
    runtime.set(
        "reconcile-exited",
        [
            CleanupRuntimeObservation::Exited {
                exit_code: Some(23),
            },
            CleanupRuntimeObservation::Exited {
                exit_code: Some(23),
            },
        ],
    );
    runtime.set("reconcile-lost", [CleanupRuntimeObservation::Missing]);
    runtime.set("reconcile-tombstone", [CleanupRuntimeObservation::Running]);

    let reconciler = service(database.clone(), runtime);
    let first = reconciler.reconcile().await.unwrap();
    assert_eq!(
        decision(&first.sessions, TASK_RUN_ID),
        RecordedSessionDecision::Running
    );
    assert_eq!(
        decision(&first.sessions, DOCUMENT_RUN_ID),
        RecordedSessionDecision::Unavailable
    );
    assert_eq!(
        decision(&first.sessions, "reconcile-exited"),
        RecordedSessionDecision::Exited
    );
    assert_eq!(
        decision(&first.sessions, "reconcile-lost"),
        RecordedSessionDecision::Lost
    );
    assert_eq!(
        decision(&first.sessions, "reconcile-tombstone"),
        RecordedSessionDecision::Recovered
    );

    let exited = agent_run::Entity::find_by_id("reconcile-exited")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(exited.status, "exited");
    assert_eq!(exited.exit_code, Some(23));
    let lost = agent_run::Entity::find_by_id("reconcile-lost")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lost.status, "lost");
    assert_eq!(lost.exit_code, None);
    let recovered_run = agent_run::Entity::find_by_id("reconcile-tombstone")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered_run.status, "exited", "history must not revive");
    assert!(session::Entity::find_by_id("reconcile-tombstone")
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .terminated_at
        .is_none());
    assert_eq!(terminal_events(&database, "reconcile-exited").await, 1);
    assert_eq!(terminal_events(&database, "reconcile-lost").await, 1);
    assert_eq!(terminal_events(&database, "reconcile-tombstone").await, 1);

    let second = reconciler.reconcile().await.unwrap();
    assert_eq!(
        decision(&second.sessions, "reconcile-lost"),
        RecordedSessionDecision::Unchanged
    );
    assert_eq!(terminal_events(&database, "reconcile-exited").await, 1);
    assert_eq!(terminal_events(&database, "reconcile-lost").await, 1);
    assert_eq!(terminal_events(&database, "reconcile-tombstone").await, 1);
}

#[tokio::test]
async fn every_recorded_session_repair_boundary_replays_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(TASK_RUN_ID, [CleanupRuntimeObservation::Unavailable]);
    runtime.set(DOCUMENT_RUN_ID, [CleanupRuntimeObservation::Unavailable]);
    for (index, checkpoint) in [
        ReconciliationCheckpoint::RuntimeObserved,
        ReconciliationCheckpoint::TerminalSessionUpdated,
        ReconciliationCheckpoint::RunFactApplied,
        ReconciliationCheckpoint::StatusAppended,
        ReconciliationCheckpoint::RepairCommitted,
    ]
    .into_iter()
    .enumerate()
    {
        let run_id = format!("reconcile-crash-{index}");
        insert_session(&database, &run_id, "running", false).await;
        runtime.set(&run_id, [CleanupRuntimeObservation::Missing]);
        let stopped = service(database.clone(), runtime.clone())
            .with_checkpoints(Arc::new(StopOnce::new(&run_id, checkpoint)))
            .reconcile()
            .await;
        assert!(stopped.is_err(), "{checkpoint:?}");

        let recovery = service(database.clone(), runtime.clone());
        recovery.reconcile().await.unwrap();
        recovery.reconcile().await.unwrap();
        let run = agent_run::Entity::find_by_id(&run_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(run.status, "lost", "{checkpoint:?}");
        assert_eq!(run.exit_code, None, "{checkpoint:?}");
        assert_eq!(
            terminal_events(&database, &run_id).await,
            1,
            "{checkpoint:?}"
        );
    }

    let exited_id = "reconcile-crash-cleanup-scheduled";
    insert_session(&database, exited_id, "running", false).await;
    runtime.set(
        exited_id,
        [
            CleanupRuntimeObservation::Exited { exit_code: Some(9) },
            CleanupRuntimeObservation::Exited { exit_code: Some(9) },
        ],
    );
    let stopped = service(database.clone(), runtime.clone())
        .with_checkpoints(Arc::new(StopOnce::new(
            exited_id,
            ReconciliationCheckpoint::CleanupScheduled,
        )))
        .reconcile()
        .await;
    assert!(stopped.is_err());
    let recovery = service(database.clone(), runtime);
    recovery.reconcile().await.unwrap();
    recovery.reconcile().await.unwrap();
    let exited = agent_run::Entity::find_by_id(exited_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(exited.status, "exited");
    assert_eq!(exited.exit_code, Some(9));
    assert_eq!(terminal_events(&database, exited_id).await, 1);
}

#[tokio::test]
async fn one_host_pass_adopts_launches_and_drains_prepared_cleanup() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(TASK_RUN_ID, [CleanupRuntimeObservation::Missing]);
    runtime.set(DOCUMENT_RUN_ID, [CleanupRuntimeObservation::Unavailable]);

    TerminalCleanupService::new(database.clone(), runtime.clone())
        .with_checkpoints(Arc::new(StopCleanupPreparation))
        .cleanup(TASK_RUN_ID, CleanupCause::Explicit, "prepared-cleanup")
        .await
        .unwrap_err();

    let request = launch_request("reconcile-launch-adoption");
    TerminalLaunchService::new(database.clone(), runtime.clone())
        .stopping_once_at(TerminalLaunchBoundary::TmuxCreated)
        .create(request)
        .await
        .unwrap_err();
    launch_effect::Entity::update_many()
        .col_expr(
            launch_effect::Column::LeaseExpiresAt,
            Expr::value(Some("2000-01-01T00:00:00Z".to_owned())),
        )
        .filter(launch_effect::Column::State.eq("leased"))
        .exec(&database)
        .await
        .unwrap();

    let reconciler = service(database.clone(), runtime);
    let first = reconciler.reconcile().await.unwrap();
    let launch_row = launch_effect::Entity::find()
        .filter(launch_effect::Column::RequestId.eq("reconcile-launch-adoption"))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        first.launches.applied, 1,
        "{first:?}; effect={launch_row:?}"
    );
    assert_eq!(first.cleanups.applied, 1);
    assert_eq!(
        cleanup_effect::Entity::find()
            .filter(cleanup_effect::Column::AgentRunId.eq(TASK_RUN_ID))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state,
        "applied"
    );
    assert_eq!(
        launch_effect::Entity::find()
            .filter(launch_effect::Column::RequestId.eq("reconcile-launch-adoption"))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state,
        "applied"
    );
    let second = reconciler.reconcile().await.unwrap();
    assert_eq!(second.launches.applied, 0);
    assert_eq!(second.cleanups.applied, 0);
}

#[tokio::test]
async fn recorded_session_scan_is_bounded_and_reports_saturation() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    for index in 0..199 {
        insert_session(
            &database,
            &format!("reconcile-bounded-{index:03}"),
            "exited",
            true,
        )
        .await;
    }
    let report = service(database, Arc::new(ScriptedRuntime::default()))
        .reconcile()
        .await
        .unwrap();
    assert_eq!(report.sessions.len(), 200);
    assert!(report.sessions_saturated);
}

#[tokio::test]
async fn applied_launch_without_a_session_is_adopted_once_including_legacy_namespace() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::default());
    let request = launch_request("inventory-applied-adoption");
    let created = TerminalLaunchService::new(database.clone(), runtime.clone())
        .create(request)
        .await
        .unwrap();
    let run_id = created.agent_run_id;
    session::Entity::delete_by_id(&run_id)
        .exec(&database)
        .await
        .unwrap();
    runtime.set_inventory([owned_inventory(&run_id, "legacy-runtime", true)]);

    let first = service(database.clone(), runtime.clone())
        .reconcile()
        .await
        .unwrap();
    assert_eq!(first.unrecorded.len(), 1);
    assert_eq!(
        first.unrecorded[0].decision,
        UnrecordedRuntimeDecision::Adopted
    );
    assert!(first.unrecorded[0].legacy_namespace);
    assert_eq!(
        session::Entity::find_by_id(&run_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .runtime_namespace
            .as_deref(),
        Some("legacy-runtime")
    );

    let second = service(database, runtime).reconcile().await.unwrap();
    assert!(second.unrecorded.is_empty());
}

#[tokio::test]
async fn owned_orphan_is_quarantined_then_cleaned_by_one_durable_effect() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let run_id = "owned-orphan-run";
    insert_run(&database, run_id, "working", false).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(run_id, [CleanupRuntimeObservation::Running]);
    runtime.set_inventory([owned_inventory(run_id, "legacy-owned-runtime", true)]);

    let first = service(database.clone(), runtime.clone())
        .reconcile()
        .await
        .unwrap();
    assert_eq!(
        first.unrecorded[0].decision,
        UnrecordedRuntimeDecision::Quarantined
    );
    let effect = cleanup_effect::Entity::find()
        .filter(cleanup_effect::Column::AgentRunId.eq(run_id))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.cause, "owned_orphan");
    assert_eq!(effect.state, "prepared");
    let evidence = effect.runtime_evidence.unwrap();
    assert_eq!(evidence["classification"], "owned_orphan");
    assert_eq!(evidence["legacyNamespace"], true);

    let grace = service(database.clone(), runtime.clone())
        .reconcile()
        .await
        .unwrap();
    assert_eq!(grace.cleanups.deferred, 1);
    cleanup_effect::Entity::update_many()
        .col_expr(
            cleanup_effect::Column::CreatedAt,
            Expr::value("2000-01-01T00:00:00Z"),
        )
        .filter(cleanup_effect::Column::AgentRunId.eq(run_id))
        .exec(&database)
        .await
        .unwrap();

    let cleaned = service(database.clone(), runtime)
        .reconcile()
        .await
        .unwrap();
    assert_eq!(cleaned.cleanups.applied, 1);
    assert_eq!(
        cleanup_effect::Entity::find()
            .filter(cleanup_effect::Column::AgentRunId.eq(run_id))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state,
        "applied"
    );
    assert_eq!(
        cleanup_effect::Entity::find()
            .filter(cleanup_effect::Column::AgentRunId.eq(run_id))
            .count(&database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn crash_during_orphan_quarantine_replays_without_duplicate_effects() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let run_id = "owned-orphan-crash";
    insert_run(&database, run_id, "working", false).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(run_id, [CleanupRuntimeObservation::Running]);
    runtime.set_inventory([owned_inventory(run_id, "legacy-owned-runtime", true)]);

    let stopped = service(database.clone(), runtime.clone())
        .with_checkpoints(Arc::new(StopOnce::new(
            run_id,
            ReconciliationCheckpoint::CleanupScheduled,
        )))
        .reconcile()
        .await;
    assert!(stopped.is_err());
    assert!(session::Entity::find_by_id(run_id)
        .one(&database)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        cleanup_effect::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );

    service(database.clone(), runtime)
        .reconcile()
        .await
        .unwrap();
    assert_eq!(
        cleanup_effect::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        1
    );
    assert!(session::Entity::find_by_id(run_id)
        .one(&database)
        .await
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn foreign_and_ambiguous_inventory_produces_stable_sanitized_conflicts() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set_inventory([
        InventoryEntry::Conflict {
            fingerprint: "foreign-fingerprint".to_owned(),
            kind: InventoryConflictKind::Foreign,
        },
        InventoryEntry::Conflict {
            fingerprint: "ambiguous-fingerprint".to_owned(),
            kind: InventoryConflictKind::Ambiguous,
        },
    ]);
    let reconciler = service(database.clone(), runtime);
    let first = reconciler.reconcile().await.unwrap();
    let second = reconciler.reconcile().await.unwrap();
    assert_eq!(first.conflicts, second.conflicts);
    assert_eq!(first.conflicts.len(), 2);
    assert_eq!(
        cleanup_effect::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        0
    );
    let diagnostic = format!("{:?}", first.conflicts);
    for forbidden in [
        "prompt",
        "argv",
        "environment",
        "socket",
        "/Users/",
        "tmux output",
    ] {
        assert!(!diagnostic.contains(forbidden));
    }
}

async fn insert_session(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    status: &str,
    ended: bool,
) {
    insert_run(database, run_id, status, ended).await;

    let source = session::Entity::find_by_id(TASK_RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap();
    let mut terminal: session::ActiveModel = source.into();
    terminal.agent_run_id = Set(run_id.to_owned());
    terminal.tmux_session_name = Set(format!("pt-{run_id}"));
    terminal.terminated_at = Set(ended.then(|| "2026-08-19T13:00:00Z".to_owned()));
    terminal.runtime_cleanup_pending = Set(false);
    terminal.insert(database).await.unwrap();
}

async fn insert_run(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    status: &str,
    ended: bool,
) {
    let source_run = agent_run::Entity::find_by_id(TASK_RUN_ID)
        .one(database)
        .await
        .unwrap()
        .unwrap();
    let mut run: agent_run::ActiveModel = source_run.into();
    run.id = Set(run_id.to_owned());
    run.status = Set(status.to_owned());
    run.ended_at = Set(ended.then(|| "2026-08-19T13:00:00Z".to_owned()));
    run.exit_code = Set(None);
    run.lifecycle_state = Set(Some(if ended { "exited" } else { "working" }.to_owned()));
    run.insert(database).await.unwrap();
}

fn owned_inventory(run_id: &str, namespace: &str, legacy_namespace: bool) -> InventoryEntry {
    InventoryEntry::Owned {
        session: OwnedSession {
            agent_run_id: run_id.to_owned(),
            runtime_namespace: namespace.to_owned(),
            running: true,
            exit_code: None,
        },
        legacy_namespace,
    }
}

async fn terminal_events(database: &sea_orm::DatabaseConnection, run_id: &str) -> u64 {
    status_event::Entity::find()
        .filter(status_event::Column::AgentRunId.eq(run_id))
        .filter(status_event::Column::EventKind.eq("agent_run.terminal"))
        .count(database)
        .await
        .unwrap()
}

fn decision(
    sessions: &[muxed_studio_lib::terminal_reconciliation::ReconciledSession],
    run_id: &str,
) -> RecordedSessionDecision {
    sessions
        .iter()
        .find(|session| session.agent_run_id == run_id)
        .unwrap()
        .decision
}

fn launch_request(id: &str) -> CreateTerminalSession {
    CreateTerminalSession {
        client_request_id: id.to_owned(),
        project_id: PROJECT_ID.to_owned(),
        issue_id: TASK_ID.to_owned(),
        module_id: MODULE_ID.to_owned(),
        target_id: TASK_ID.to_owned(),
        kind: TerminalLaunchKind::Task,
        provider: Some("codex".to_owned()),
        model: None,
        reasoning: None,
        policy_reference: None,
        prompt: None,
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: Vec::new(),
        working_directory_identity: format!("task:{}", TASK_ID.replace('-', "")),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 40,
    }
}
