use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{Database, EntityTrait};
use ticketry_entities::{agent_run, launch_material};
use ticketry_launch::{
    CreateTerminalSession, InteractiveLaunchAuthority, LaunchAuthorityError,
    ResolvedLaunchMaterial, TerminalLaunchError, TerminalLaunchKind,
};
use ticketry_terminal::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};

#[derive(Clone)]
struct PromptlessInstantAuthority;

#[async_trait]
impl InteractiveLaunchAuthority for PromptlessInstantAuthority {
    async fn resolve(
        &self,
        _request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        Ok(ResolvedLaunchMaterial {
            provider: Some("codex".to_owned()),
            ..ResolvedLaunchMaterial::default()
        })
    }
}

#[derive(Clone)]
struct ExistingRuntime;

#[async_trait]
impl TerminalLaunchRuntime for ExistingRuntime {
    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
            tmux_session_name: "ticketry-instant-run".to_owned(),
            runtime_namespace: "test-runtime".to_owned(),
        })
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        unreachable!("the fixture already exposes the settled runtime")
    }
}

#[tokio::test]
async fn promptless_instant_launch_waits_for_the_first_request() {
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
    ticketry_work_management::workspace_tab_order_migration::install(&database)
        .await
        .unwrap();
    let service = TerminalLaunchService::new(database.clone(), Arc::new(ExistingRuntime))
        .with_authority(Arc::new(PromptlessInstantAuthority));

    let session = service
        .create(CreateTerminalSession {
            client_request_id: "promptless-instant-request".to_owned(),
            project_id: super::execution_legacy_fixture::PROJECT.to_owned(),
            issue_id: super::execution_legacy_fixture::MODULE.to_owned(),
            module_id: super::execution_legacy_fixture::MODULE.to_owned(),
            target_id: super::execution_legacy_fixture::MODULE.to_owned(),
            kind: TerminalLaunchKind::Instant,
            provider: None,
            profile: None,
            model: None,
            reasoning: None,
            policy_reference: None,
            prompt: None,
            resume_from_agent_run_id: None,
            automation_attempt_id: None,
            required_skills: Vec::new(),
            working_directory_identity: format!(
                "module:{}",
                super::execution_legacy_fixture::MODULE
            ),
            design_directory_identity: None,
            document_relative_path: None,
            columns: 120,
            rows: 40,
        })
        .await
        .unwrap();
    let run = agent_run::Entity::find_by_id(&session.agent_run_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(run.lifecycle_state.as_deref(), Some("needs_input"));
}
