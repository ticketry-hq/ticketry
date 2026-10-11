use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database};
use std::sync::Arc;
use ticketry_launch::{CreateTerminalSession, TerminalLaunchError, TerminalLaunchKind};
use ticketry_provider::SkillSearchEnvironment;
use ticketry_terminal::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation,
};

struct NoRuntime;
#[async_trait]
impl TerminalLaunchRuntime for NoRuntime {
    async fn observe(&self, _: &str) -> TerminalRuntimeObservation {
        TerminalRuntimeObservation::Missing
    }
    async fn materialize_and_create(
        &self,
        _: &ticketry_entities::launch_material::Model,
        _: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        unreachable!()
    }
}

#[tokio::test]
async fn accepted_task_launch_records_missing_stage_skills_and_rechecks_the_selected_worktree() {
    let directory = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let worktree = tempfile::tempdir().unwrap();
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
    ticketry_workspace_runtime::install_pull_request_url_migration(&database)
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "UPDATE worktrees SET task_id = '{}', path = '{}'",
            super::execution_legacy_fixture::SERIAL_ROOT,
            worktree.path().display()
        ))
        .await
        .unwrap();
    let service = TerminalLaunchService::new(database.clone(), Arc::new(NoRuntime))
        .with_skill_search_environment(SkillSearchEnvironment {
            home: Some(home.path().to_owned()),
            ..Default::default()
        });
    let request = CreateTerminalSession {
        client_request_id: "missing-skill-launch".to_owned(),
        project_id: super::execution_legacy_fixture::PROJECT.to_owned(),
        issue_id: super::execution_legacy_fixture::CLAIMED_CHILD.to_owned(),
        module_id: super::execution_legacy_fixture::MODULE.to_owned(),
        target_id: super::execution_legacy_fixture::CLAIMED_CHILD.to_owned(),
        kind: TerminalLaunchKind::Task,
        provider: Some("codex".to_owned()),
        profile: None,
        model: None,
        reasoning: None,
        policy_reference: None,
        prompt: Some("Stage skills: [\"tdd\"]".to_owned()),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: Vec::new(),
        stage_skills: vec!["tdd".to_owned()],
        working_directory_identity: format!(
            "task:{}",
            super::execution_legacy_fixture::CLAIMED_CHILD
        ),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 40,
    };
    let first = service.prepare_policy(request.clone(), None).await.unwrap();
    let runs = ticketry_runs::RunsServices::new(database.clone());
    let holdings = runs
        .queries()
        .run_holdings(super::execution_legacy_fixture::PROJECT, None)
        .await
        .unwrap();
    let warning = holdings
        .iter()
        .find(|run| run.agent_run_id == first.agent_run_id)
        .unwrap()
        .stage_skill_availability
        .as_deref()
        .unwrap();
    let warning: serde_json::Value = serde_json::from_str(warning).unwrap();
    assert_eq!(warning["provider"], "codex");
    assert_eq!(warning["skills"][0]["status"], "missing");
    assert!(
        warning["searched_roots"]
            .as_array()
            .unwrap()
            .iter()
            .any(|root| root.as_str()
                == Some(worktree.path().join(".agents/skills").to_str().unwrap())),
        "{warning}"
    );
    assert!(!worktree.path().join(".agents").exists());
    let skill = worktree.path().join(".agents/skills/tdd");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "installed").unwrap();
    let mut request = request;
    request.client_request_id = "installed-skill-launch".to_owned();
    let second = service.prepare_policy(request, None).await.unwrap();
    let holdings = runs
        .queries()
        .run_holdings(super::execution_legacy_fixture::PROJECT, None)
        .await
        .unwrap();
    assert_eq!(
        holdings
            .iter()
            .find(|run| run.agent_run_id == second.agent_run_id)
            .unwrap()
            .stage_skill_availability,
        None
    );
    assert!(holdings
        .iter()
        .find(|run| run.agent_run_id == first.agent_run_id)
        .unwrap()
        .stage_skill_availability
        .is_some());
}
