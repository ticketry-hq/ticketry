//! An acknowledged launch joins recovery of its exact durable effect.
use async_trait::async_trait;
use sea_orm::Database;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use ticketry_launch::{CreateTerminalSession, TerminalLaunchError, TerminalLaunchKind};
use ticketry_terminal::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};

#[derive(Default)]
struct RecoveryRuntime {
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
    running: AtomicBool,
    creations: AtomicUsize,
}
#[async_trait]
impl TerminalLaunchRuntime for RecoveryRuntime {
    async fn observe(&self, _: &str) -> TerminalRuntimeObservation {
        if self.running.load(Ordering::SeqCst) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: "ticketry-dispatch-race".to_owned(),
                runtime_namespace: "test-dispatch-race".to_owned(),
            })
        } else {
            TerminalRuntimeObservation::Missing
        }
    }
    async fn materialize_and_create(
        &self,
        _: &ticketry_entities::launch_material::Model,
        _: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        self.creations.fetch_add(1, Ordering::SeqCst);
        self.started.notify_one();
        self.release.notified().await;
        self.running.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn direct_acknowledgement_joins_the_recovery_executor_for_the_same_launch_effect() {
    let directory = tempfile::tempdir().unwrap();
    super::execution_legacy_fixture::provision_current(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    ticketry_work_management::install_workspace_tab_order_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .unwrap();
    let runtime = Arc::new(RecoveryRuntime::default());
    let direct = TerminalLaunchService::new(database.clone(), runtime.clone());
    let recovery = TerminalLaunchService::new(database, runtime.clone());
    let module = super::execution_legacy_fixture::MODULE;
    let accepted = direct
        .prepare(CreateTerminalSession {
            client_request_id: "recovering-dispatch-acknowledgement".to_owned(),
            project_id: super::execution_legacy_fixture::PROJECT.to_owned(),
            issue_id: module.to_owned(),
            module_id: module.to_owned(),
            target_id: module.to_owned(),
            kind: TerminalLaunchKind::Shell,
            provider: None,
            profile: None,
            model: None,
            reasoning: None,
            policy_reference: None,
            prompt: None,
            resume_from_agent_run_id: None,
            automation_attempt_id: None,
            required_skills: Vec::new(),
            stage_skills: Vec::new(),
            working_directory_identity: format!("module:{module}"),
            design_directory_identity: None,
            document_relative_path: None,
            columns: 120,
            rows: 40,
        })
        .await
        .unwrap();
    let run_id = accepted.agent_run_id.clone();
    let worker = tokio::spawn(async move { recovery.reconcile().await });
    runtime.started.notified().await;
    let mut caller = tokio::spawn(async move { direct.execute_accepted(accepted).await });
    let premature = tokio::time::timeout(std::time::Duration::from_millis(100), &mut caller).await;
    let acknowledged_before_settlement = premature.is_ok();
    runtime.release.notify_one();
    let worker = worker.await.unwrap().unwrap();
    let caller = match premature {
        Ok(completed) => completed,
        Err(_) => caller.await,
    };
    let session = caller
        .unwrap()
        .expect("another executor's lease must resolve to the same acknowledged session");
    assert!(
        !acknowledged_before_settlement,
        "acknowledgement waits until the owned runtime settles"
    );
    assert_eq!(worker.applied, 1);
    assert_eq!(session.agent_run_id, run_id);
    assert_eq!(runtime.creations.load(Ordering::SeqCst), 1);
}
