//! An interactive MCP launch whose replacement kill fails must report the
//! actionable fact (the previous agent is still alive) instead of folding the
//! kill failure into a generic terminal-launch unavailability.

use sea_orm::ConnectionTrait;
use serde_json::json;
use ticketry_mcp::{McpConfiguration, McpRuntime};
use ticketry_terminal::{CleanupKillResult, CleanupRuntimeObservation, TerminalLaunchService};
use ticketry_work_management::open_for_commands;

#[path = "common/execution_legacy_fixture.rs"]
mod execution_legacy_fixture;

const MODULE: &str = "00000000000000000000000000089305";

struct FailingKillRuntime;

#[async_trait::async_trait]
impl ticketry_terminal::TerminalCleanupRuntime for FailingKillRuntime {
    async fn inspect(&self, _: &ticketry_entities::session::Model) -> CleanupRuntimeObservation {
        CleanupRuntimeObservation::Running
    }

    async fn kill_verified(
        &self,
        _: &ticketry_entities::session::Model,
    ) -> ticketry_terminal::CleanupKillResult {
        CleanupKillResult::Unconfirmed
    }
}

#[async_trait::async_trait]
impl ticketry_terminal::TerminalLaunchRuntime for FailingKillRuntime {
    async fn observe(&self, _: &str) -> ticketry_terminal::TerminalRuntimeObservation {
        unreachable!("a failed kill must stop the launch before spawning")
    }

    async fn materialize_and_create(
        &self,
        _: &ticketry_entities::launch_material::Model,
        _: &dyn ticketry_terminal::TerminalLaunchCheckpoint,
    ) -> Result<(), ticketry_launch::TerminalLaunchError> {
        unreachable!("a failed kill must stop the launch before spawning")
    }
}

#[tokio::test]
async fn a_failed_replacement_kill_reports_previous_agent_not_ended() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    execution_legacy_fixture::provision_current(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    ticketry_agent_execution::ensure_adopted(directory.path())
        .await
        .unwrap();
    let database = open_for_commands(&path).await.unwrap();
    // The module link, the live agent the interactive launch must replace,
    // and its open terminal session.
    // The adopted worktrees row predates the pull-request column the entity
    // contract expects.
    database
        .execute_unprepared("ALTER TABLE worktrees ADD COLUMN pull_request_url varchar NULL")
        .await
        .unwrap();
    ticketry_work_management::schema::install(&database)
        .await
        .unwrap();
    ticketry_work_management::workspace_tab_order_migration::install(&database)
        .await
        .unwrap();
    ticketry_work_management::project_onboarding_migration::install(&database)
        .await
        .unwrap();
    ticketry_work_management::launch_binding_stage_skills_migration::install(&database)
        .await
        .unwrap();
    ticketry_work_management::launch_binding_profile_migration::install(&database)
        .await
        .unwrap();
    // The run grant resolves its project through this catalog entry.
    ticketry_work_management::module_presentation_migration::install(&database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &directory.path().display().to_string())
        .await
        .unwrap();
    // The launch policy needs a binding for the Implementation type at the
    // child's current state.
    database
        .execute_unprepared(
            "INSERT INTO worktracker_launchbinding (issue_type_id, state_id, prompt, required_skills, auto_start, subtree_run_enabled, created_at, updated_at) VALUES ('00000000000000000000000000089304', '00000000000000000000000000089302', 'Build the ticket.', '[]', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .await
        .unwrap();
    // The provider catalog's global default supplies the agent the launch
    // runs.
    database
        .execute_unprepared(
            r#"INSERT INTO app_settings (scope, "key", value, updated_at) VALUES ('host', 'provider_catalog', '{"global_default": {"provider": "codex"}}', '2026-08-19 17:00:00')"#,
        )
        .await
        .unwrap();
    let seeded = database
        .execute_unprepared(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) VALUES ('run-valid', '00000000000000000000000000089307', 'codex', 'running', '2026-08-19 12:30:00', 'task')",
        )
        .await
        .unwrap();
    assert_eq!(seeded.rows_affected(), 1, "the live run must seed");
    // The live run's open terminal session is what the replacement kill
    // will find and fail to end.
    database
        .execute_unprepared(
            "INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) VALUES ('run-valid', 'run-valid', '00000000000000000000000000089307', '00000000000000000000000000089305', '00000000000000000000000000089301', '2026-08-19 12:30:00', 'task')",
        )
        .await
        .unwrap();
    database.close().await.unwrap();

    let ownership = ticketry_data_directory::DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test_with_terminal_launch(
        McpConfiguration {
            database_path: path.clone(),
            media_root: directory.path().join("media"),
        },
        &ownership,
        std::sync::Arc::new(FailingKillRuntime),
        TerminalLaunchService::new(
            open_for_commands(&path).await.unwrap(),
            std::sync::Arc::new(FailingKillRuntime),
        ),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test(
            "run-valid",
            "valid",
            ticketry_mcp::allowed_provider_operations(),
            false,
        )
        .await
        .map(|_| ())
        .unwrap_or_else(|failure| panic!("grant failed: {failure:?}"));
    let mut run =
        ticketry_mcp::SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid")
            .await;

    let launched = run
        .structured(
            1,
            "launch_default_coding_agent",
            json!({"id_or_key": "T893-893"}),
        )
        .await;
    assert_eq!(launched["error"], "previous_agent_not_ended", "{launched}");
}
