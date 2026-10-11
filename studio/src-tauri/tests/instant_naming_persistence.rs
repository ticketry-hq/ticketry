//! The resolved naming source survives durable terminal-launch preparation.
use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::Database;
use ticketry_entities::launch_material;
use ticketry_launch::{
    CreateTerminalSession, InteractiveLaunchAuthority, LaunchAuthorityError,
    ResolvedLaunchMaterial, TerminalLaunchError, TerminalLaunchKind,
};
use ticketry_runs::RunsServices;
use ticketry_terminal::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation,
};

#[path = "common/execution_legacy_fixture.rs"]
mod fixture;

const SOURCE: &str = "codex-instant-naming:v1:request-offset:18";

struct ResolvedSource;

#[async_trait]
impl InteractiveLaunchAuthority for ResolvedSource {
    async fn resolve(
        &self,
        _request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        Ok(ResolvedLaunchMaterial {
            provider: Some("codex".into()),
            policy_reference: Some(SOURCE.into()),
            prompt: Some("Talk about 🦀.\n\nInvestigate the terminal issue".into()),
            ..ResolvedLaunchMaterial::default()
        })
    }
}

struct PreparationOnly;

#[async_trait]
impl TerminalLaunchRuntime for PreparationOnly {
    async fn observe(&self, _run: &str) -> TerminalRuntimeObservation {
        unreachable!("preparing a durable launch does not start or inspect a provider")
    }

    async fn materialize_and_create(
        &self,
        _material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        unreachable!("preparing a durable launch does not create a provider")
    }
}

#[tokio::test]
async fn authoritative_instant_source_is_retained_in_the_existing_launch_effect_after_reopen() {
    let directory = tempfile::tempdir().unwrap();
    fixture::provision_current(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let url = format!(
        "sqlite:{}?mode=rw",
        directory.path().join("state.db").display()
    );
    let database = Database::connect(&url).await.unwrap();
    ticketry_work_management::install_workspace_tab_order_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .unwrap();
    let request = CreateTerminalSession {
        client_request_id: "instant-naming-persistence".into(),
        project_id: fixture::PROJECT.into(),
        issue_id: fixture::MODULE.into(),
        module_id: fixture::MODULE.into(),
        target_id: fixture::MODULE.into(),
        kind: TerminalLaunchKind::Instant,
        provider: None,
        profile: None,
        model: None,
        reasoning: None,
        policy_reference: Some("caller-source-must-not-survive".into()),
        prompt: Some("caller-prompt-must-not-survive".into()),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: Vec::new(),
        stage_skills: Vec::new(),
        working_directory_identity: format!("module:{}", fixture::MODULE),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 40,
    };
    let effect_id = request.effect_id();
    let service = TerminalLaunchService::new(database.clone(), Arc::new(PreparationOnly))
        .with_authority(Arc::new(ResolvedSource));
    let accepted = service.prepare(request).await.unwrap();
    let run_id = accepted.agent_run_id;
    drop(service);
    database.close().await.unwrap();

    let database = Database::connect(&url).await.unwrap();
    let services = RunsServices::new(database);
    let effect = services
        .effects()
        .effects()
        .find(&effect_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(effect.policy_reference.as_deref(), Some(SOURCE));
    assert_eq!(effect.agent_run_id, run_id);
    assert_eq!(effect.provider.as_deref(), Some("codex"));
    assert_eq!(effect.scope, "instant");
    assert_eq!(effect.state, "prepared");
    assert_eq!(effect.attempt_count, 0);
}
