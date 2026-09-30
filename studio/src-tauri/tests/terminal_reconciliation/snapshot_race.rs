use super::{decision, insert_session, ScriptedRuntime, TerminalLifecycleHarness, TASK_RUN_ID};
use sea_orm::EntityTrait;
use std::os::unix::fs::PermissionsExt;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use ticketry_entities::{agent_run, session};
use ticketry_terminal::{
    ApprovedArgv, CleanupKillResult, CleanupRuntimeObservation, CreateOutcome, CreateSession,
    RecordedSessionDecision, RuntimeSnapshot, TerminalCleanupRuntime, TerminalGeometry,
    TerminalReconciliationService, TerminalRuntimeIdentity, TmuxAdapter, TmuxCleanupRuntime,
    TmuxRuntimeObservation,
};

const NEW_RUN: &str = "published-after-snapshot";

struct PublishingRuntime {
    database: sea_orm::DatabaseConnection,
    request: CreateSession,
    snapshots: AtomicUsize,
}

#[async_trait::async_trait]
impl TerminalCleanupRuntime for PublishingRuntime {
    async fn inspect(&self, _: &session::Model) -> CleanupRuntimeObservation {
        panic!("the sweep must use its single snapshot");
    }

    async fn kill_verified(&self, _: &session::Model) -> CleanupKillResult {
        panic!("this sweep must not kill a runtime");
    }

    async fn snapshot(&self) -> Option<RuntimeSnapshot> {
        let snapshot = TmuxCleanupRuntime.snapshot().await;
        // Create, verify, and commit after the listing, before its caller resumes.
        if self.snapshots.fetch_add(1, Ordering::SeqCst) == 0 {
            let adapter = TmuxAdapter::discover().unwrap();
            assert_eq!(
                adapter.create(&self.request).unwrap(),
                CreateOutcome::Created
            );
            assert_eq!(
                adapter.observe(&self.request.identity),
                TmuxRuntimeObservation::Running
            );
            insert_session(&self.database, NEW_RUN, "working", false).await;
        }
        snapshot
    }
}

#[tokio::test]
async fn sessions_published_after_the_snapshot_wait_for_the_next_sweep() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    let shell = harness.data_directory().join("race-shell");
    std::fs::write(&shell, "#!/bin/sh\nwhile :; do /bin/sleep 1; done\n").unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runtime = Arc::new(PublishingRuntime {
        database: database.clone(),
        request: CreateSession {
            identity: TerminalRuntimeIdentity::new(NEW_RUN, &harness.runtime_namespace).unwrap(),
            geometry: TerminalGeometry::new(80, 24).unwrap(),
            command: ApprovedArgv::for_login_shell(shell, harness.data_directory().to_path_buf())
                .unwrap(),
        },
        snapshots: AtomicUsize::new(0),
    });
    let service = TerminalReconciliationService::new(
        database.clone(),
        Arc::new(ScriptedRuntime::default()),
        runtime.clone(),
    );

    let first = service.reconcile().await.unwrap();
    let run = agent_run::Entity::find_by_id(NEW_RUN)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "working");
    assert!(run.ended_at.is_none());
    let terminal = session::Entity::find_by_id(NEW_RUN)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(terminal.terminated_at.is_none());
    assert_eq!(terminal.agent_run_id, NEW_RUN);
    assert_eq!(terminal.tmux_session_name, format!("pt-{NEW_RUN}"));
    assert_eq!(
        terminal.runtime_namespace.as_deref(),
        Some(harness.runtime_namespace.as_str())
    );
    assert!(!first.sessions.iter().any(|row| row.agent_run_id == NEW_RUN));
    assert_eq!(
        decision(&first.sessions, TASK_RUN_ID),
        RecordedSessionDecision::Lost
    );
    assert_eq!(runtime.snapshots.load(Ordering::SeqCst), 1);

    let second = service.reconcile().await.unwrap();
    assert_eq!(
        decision(&second.sessions, NEW_RUN),
        RecordedSessionDecision::Running
    );
    assert_eq!(runtime.snapshots.load(Ordering::SeqCst), 2);
    assert_eq!(
        agent_run::Entity::find_by_id(NEW_RUN)
            .one(&database)
            .await
            .unwrap()
            .unwrap(),
        run
    );
    assert_eq!(
        session::Entity::find_by_id(NEW_RUN)
            .one(&database)
            .await
            .unwrap()
            .unwrap(),
        terminal
    );
    assert!(harness.tmux.has_agent_run(NEW_RUN));
}
