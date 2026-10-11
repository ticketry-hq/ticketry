//! One launch-delivery boundary fact: a fresh launch that cannot be prepared
//! leaves the live agent it was about to replace untouched.

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_agent_execution::execute_launch_delivery as execute;
use ticketry_launch::{CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode};
use ticketry_terminal::{
    CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime, TerminalCleanupService,
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation,
};
use ticketry_work_management::open_for_commands;
use ticketry_work_management::{record, CallerScope, LaunchPolicyDecision, ModuleLinkInput};

#[path = "../../../../../tests/common/execution_legacy_fixture.rs"]
mod execution_legacy_fixture;

use execution_legacy_fixture::{CLAIMED_CHILD, MODULE, PROJECT};

const LIVE_RUN: &str = "run-live";

struct RejectingRuntime;

#[async_trait]
impl TerminalLaunchRuntime for RejectingRuntime {
    async fn preflight(&self, _request: &CreateTerminalSession) -> Result<(), TerminalLaunchError> {
        Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::UnusableFolder,
            "the module folder disappeared since the decision",
        ))
    }

    async fn observe(&self, _agent_run_id: &str) -> TerminalRuntimeObservation {
        TerminalRuntimeObservation::Missing
    }

    async fn materialize_and_create(
        &self,
        _material: &ticketry_entities::launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        unreachable!("a rejected preparation never materializes")
    }
}

struct SettlingCleanupRuntime;

#[async_trait]
impl TerminalCleanupRuntime for SettlingCleanupRuntime {
    async fn inspect(
        &self,
        _terminal: &ticketry_entities::session::Model,
    ) -> CleanupRuntimeObservation {
        CleanupRuntimeObservation::Missing
    }

    async fn kill_verified(
        &self,
        _terminal: &ticketry_entities::session::Model,
    ) -> CleanupKillResult {
        CleanupKillResult::Killed
    }
}

fn decision() -> LaunchPolicyDecision {
    LaunchPolicyDecision {
        version: 3,
        decision_id: "decision-1843".to_owned(),
        policy_identity: "binding:1".to_owned(),
        policy_version: 7,
        caller_scope: CallerScope::RunNow,
        idempotency_key: "transport-request".to_owned(),
        handoff: false,
        task_id: CLAIMED_CHILD.to_owned(),
        project_id: PROJECT.to_owned(),
        issue_type_id: "00000000000000000000000000089304".to_owned(),
        state_id: "00000000000000000000000000089302".to_owned(),
        state_name: Some("Todo".to_owned()),
        prompt: "Implement this Story.".to_owned(),
        required_skills: Vec::new(),
        stage_skills: Vec::new(),
        provider: "codex".to_owned(),
        profile: None,
        model: Some("slice6-model".to_owned()),
        reasoning: None,
        module_link: ModuleLinkInput {
            module_id: MODULE.to_owned(),
            path: None,
        },
    }
}

async fn count(database: &sea_orm::DatabaseConnection, sql: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap()
}

#[tokio::test]
async fn a_rejected_preparation_leaves_the_live_agent_alone() {
    let directory = tempfile::tempdir().unwrap();
    execution_legacy_fixture::provision_current(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let path = directory.path().join("state.db");
    let database = open_for_commands(&path).await.unwrap();
    // Bring the WorkTracker columns the entity contract expects up to the
    // current shape before anything reads or writes a module row.
    ticketry_work_management::install_workspace_tab_order_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_module_presentation_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .unwrap();
    // The adopted worktrees row predates the pull-request column the entity
    // contract expects.
    database
        .execute_unprepared("ALTER TABLE worktrees ADD COLUMN pull_request_url varchar NULL")
        .await
        .unwrap();
    // A linked module folder the runtime will then refuse to launch in, so
    // preparation rejects at preflight rather than at scope validation.
    ticketry_work_management::install_module_links_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &directory.path().display().to_string())
        .await
        .unwrap();

    // The live agent this launch is about to replace.
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) VALUES ('{LIVE_RUN}', '{CLAIMED_CHILD}', 'codex', 'running', '2026-08-19 12:30:00', 'task')"
        ))
        .await
        .unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) VALUES ('{LIVE_RUN}', '{LIVE_RUN}', '{CLAIMED_CHILD}', '{MODULE}', '{PROJECT}', '2026-08-19 12:30:00', 'task')"
        ))
        .await
        .unwrap();

    let decision = decision();
    record(&database, &decision).await.unwrap();

    let launch =
        TerminalLaunchService::new(database.clone(), std::sync::Arc::new(RejectingRuntime));
    let cleanup = TerminalCleanupService::new(
        database.clone(),
        std::sync::Arc::new(SettlingCleanupRuntime),
    );
    let failure = execute(&database, &launch, &cleanup, &decision)
        .await
        .unwrap_err();

    assert_eq!(failure, "module_folder_unusable");
    // The live agent is still here: its session is open, its run is running,
    // and no cleanup effect was ever minted for it.
    assert_eq!(
        count(
            &database,
            &format!(
                "SELECT COUNT(*) AS count FROM agent_terminal_sessions WHERE agent_run_id = '{LIVE_RUN}' AND terminated_at IS NULL AND runtime_cleanup_pending = 0"
            )
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &database,
            &format!(
                "SELECT COUNT(*) AS count FROM agent_runs WHERE id = '{LIVE_RUN}' AND ended_at IS NULL"
            )
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) AS count FROM terminal_cleanup_effects"
        )
        .await,
        0
    );
    // A rejected preparation mints nothing and leaves the decision replayable.
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) AS count FROM runs_launch_effects"
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) AS count FROM ticketry_launchpolicydecision WHERE decision_id = 'decision-1843' AND delivered_at IS NULL"
        )
        .await,
        1
    );
}

#[tokio::test]
async fn continued_handoff_checks_the_live_provider_and_its_persisted_directory() {
    let directory = tempfile::tempdir().unwrap();
    let module_folder = tempfile::tempdir().unwrap();
    let live_folder = tempfile::tempdir().unwrap();
    execution_legacy_fixture::provision_current(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    ticketry_work_management::install_workspace_tab_order_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::install_module_presentation_schema(&database)
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
    ticketry_work_management::install_module_links_schema(&database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, module_folder.path().to_str().unwrap())
        .await
        .unwrap();
    let run_id = uuid::Uuid::new_v4().to_string();
    let session_name = ticketry_terminal::PersistedSessionName::for_agent_run(&run_id)
        .unwrap()
        .into_string();
    database.execute_unprepared(&format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope, cwd) VALUES ('{run_id}', '{CLAIMED_CHILD}', 'claude', 'running', '2026-08-19 12:30:00', 'task', '{}'); INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope, agent) VALUES ('{run_id}', '{session_name}', '{CLAIMED_CHILD}', '{MODULE}', '{PROJECT}', '2026-08-19 12:30:00', 'task', 'claude');", live_folder.path().display()
    )).await.unwrap();
    let name = format!("ticketry-disposable-stage-skill-{}", uuid::Uuid::new_v4());
    let wrong_provider_skill = module_folder.path().join(".agents/skills").join(&name);
    std::fs::create_dir_all(&wrong_provider_skill).unwrap();
    std::fs::write(
        wrong_provider_skill.join("SKILL.md"),
        "module's codex skill",
    )
    .unwrap();
    let mut decision = decision();
    decision.handoff = true;
    decision.stage_skills = vec![name.clone()];
    record(&database, &decision).await.unwrap();
    let launch =
        TerminalLaunchService::new(database.clone(), std::sync::Arc::new(RejectingRuntime));
    let cleanup = TerminalCleanupService::new(
        database.clone(),
        std::sync::Arc::new(SettlingCleanupRuntime),
    );
    // This deliberately absent runtime rejects typed delivery; the public handoff
    // seam still records its advisory report and never starts a fresh provider.
    assert!(execute(&database, &launch, &cleanup, &decision)
        .await
        .is_err());
    let runs = ticketry_runs::RunsServices::new(database.clone());
    let holdings = runs.queries().run_holdings(PROJECT, None).await.unwrap();
    let warning = holdings
        .iter()
        .find(|run| run.agent_run_id == run_id)
        .unwrap()
        .stage_skill_availability
        .as_deref()
        .unwrap();
    let warning: serde_json::Value = serde_json::from_str(warning).unwrap();
    assert_eq!(warning["provider"], "claude");
    assert_eq!(warning["skills"][0]["requested"], name);
    assert_eq!(warning["skills"][0]["status"], "missing");
    assert!(warning["searched_roots"]
        .as_array()
        .unwrap()
        .iter()
        .any(|root| root.as_str()
            == Some(live_folder.path().join(".claude/skills").to_str().unwrap())));
    assert!(!live_folder.path().join(".claude").exists());
    let skill = live_folder.path().join(".claude/skills").join(&name);
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "installed into the live provider's actual directory",
    )
    .unwrap();
    decision.decision_id = "decision-2724-second-handoff".to_owned();
    decision.idempotency_key = "transport-second-handoff".to_owned();
    record(&database, &decision).await.unwrap();
    assert!(execute(&database, &launch, &cleanup, &decision)
        .await
        .is_err());
    let holdings = runs.queries().run_holdings(PROJECT, None).await.unwrap();
    assert_eq!(
        holdings
            .iter()
            .find(|run| run.agent_run_id == run_id)
            .unwrap()
            .stage_skill_availability,
        None
    );
}
