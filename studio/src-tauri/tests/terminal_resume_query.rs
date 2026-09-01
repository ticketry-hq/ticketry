mod common;

use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use ticketry_terminal::{
    ResumableConversationService, RESUMABLE_LIMIT, RESUMABLE_STATEMENT_LIMIT,
};

#[tokio::test]
async fn resumable_query_is_bounded_to_ten_conversations() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    for index in 1..=12 {
        insert_ended_task_run(
            &database,
            &format!("ended-{index:02}"),
            &format!("provider-{index:02}"),
            &format!("2026-08-19T12:{index:02}:00Z"),
            "codex",
        )
        .await;
    }
    insert_ended_task_run(
        &database,
        "ended-09-newer",
        "provider-09",
        "2026-08-19T13:09:00Z",
        "codex",
    )
    .await;
    insert_live_run(&database, "live-provider", Some("provider-11"), None).await;
    insert_live_run(&database, "live-successor", None, Some("ended-10")).await;

    let rows = ResumableConversationService::new(database)
        .list(Some(TASK_ID.to_owned()), None, None)
        .await
        .unwrap();

    assert_eq!(rows.len(), RESUMABLE_LIMIT as usize);
    assert_eq!(RESUMABLE_STATEMENT_LIMIT, 11);
    assert_eq!(rows[0].id, "ended-09-newer");
    assert_eq!(
        rows.iter()
            .filter(|row| row.provider_session_id.as_deref() == Some("provider-09"))
            .count(),
        1
    );
    assert!(!rows.iter().any(|row| row.id == "ended-10"));
    assert!(!rows
        .iter()
        .any(|row| row.provider_session_id.as_deref() == Some("provider-11")));
}

#[tokio::test]
async fn custom_query_matches_generated_agent_run_fields() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_ended_task_run(
        &database,
        "parity-run",
        "parity-provider-session",
        "2026-08-19T14:00:00Z",
        "claude",
    )
    .await;

    let response = harness
        .graphql(
            r#"query($task: String!) {
              resumable: resumable_terminal_sessions(task_id: $task) {
                id agent status startedAt endedAt providerSessionId resumedFrom scope
              }
              generated: agentRuns(filters: { id: { eq: "parity-run" } }) {
                nodes { id agent status startedAt endedAt providerSessionId resumedFrom scope }
              }
            }"#,
            serde_json::json!({ "task": TASK_ID }),
        )
        .await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    assert_eq!(
        response["data"]["resumable"][0],
        response["data"]["generated"]["nodes"][0]
    );
}

#[tokio::test]
async fn terminated_provider_history_remains_resumable_after_profile_hydration() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_ended_task_run(
        &database,
        "hydrated-run",
        "hydrated-provider-session",
        "2026-08-19T14:30:00Z",
        "codex",
    )
    .await;
    database
        .execute_unprepared(
            "UPDATE agent_terminal_sessions \
             SET runtime_namespace='tmux-source-installation', \
                 task_id='00000000-0000-0000-0000-000000008647', \
                 module_id='00000000-0000-0000-0000-000000008644', \
                 project_id='00000000-0000-0000-0000-000000008641' \
             WHERE agent_run_id='hydrated-run'",
        )
        .await
        .unwrap();
    let normalized_match = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM agent_terminal_sessions s \
             WHERE replace(s.task_id, '-', '')='00000000000000000000000000008647' \
               AND replace(s.project_id, '-', '') IN (SELECT id FROM worktracker_project) \
               AND s.agent_run_id='hydrated-run'",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(normalized_match.try_get::<i64>("", "count").unwrap(), 1);

    let rows = ResumableConversationService::new(database)
        .list(Some(TASK_ID.to_owned()), None, None)
        .await
        .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "hydrated-run");
}

#[tokio::test]
async fn scratch_query_uses_project_module_and_scratch_scope() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_ended_scratch_run(&database, "scratch-plan", "scratch-provider", "plan").await;
    database
        .execute_unprepared(
            "UPDATE agent_terminal_sessions \
             SET task_id='00000000-0000-0000-0000-000000000000', \
                 module_id='00000000-0000-0000-0000-000000008644', \
                 project_id='00000000-0000-0000-0000-000000008641' \
             WHERE agent_run_id='scratch-plan'",
        )
        .await
        .unwrap();
    insert_ended_task_run(
        &database,
        "task-neighbour",
        "task-provider",
        "2026-08-19T15:00:00Z",
        "codex",
    )
    .await;

    let rows = ResumableConversationService::new(database)
        .list(
            None,
            Some(PROJECT_ID.to_owned()),
            Some(MODULE_ID.to_owned()),
        )
        .await
        .unwrap();

    assert_eq!(
        rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["scratch-plan"]
    );
}

async fn insert_ended_task_run(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    provider_session_id: &str,
    ended_at: &str,
    agent: &str,
) {
    let namespace = ticketry_terminal::current_runtime_namespace().unwrap();
    let sql = format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, lifecycle_state, lifecycle_updated_at, scope) \
         VALUES ('{run_id}', '{}', '{agent}', 'completed', '2026-08-19T10:00:00Z', '{ended_at}', '{provider_session_id}', 'exited', '{ended_at}', 'task'); \
         INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) \
         VALUES ('{run_id}', 'pt-{run_id}', '{}', '{}', '{}', '2026-08-19T10:00:00Z', '{ended_at}', 'task', 0, '{namespace}', 0, '{agent}');",
        compact(TASK_ID),
        compact(TASK_ID),
        compact(MODULE_ID),
        compact(PROJECT_ID),
    );
    database.execute_unprepared(&sql).await.unwrap();
}

async fn insert_live_run(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    provider_session_id: Option<&str>,
    resumed_from: Option<&str>,
) {
    let provider = provider_session_id
        .map(|value| format!("'{value}'"))
        .unwrap_or_else(|| "NULL".to_owned());
    let predecessor = resumed_from
        .map(|value| format!("'{value}'"))
        .unwrap_or_else(|| "NULL".to_owned());
    database
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, provider_session_id, lifecycle_state, lifecycle_updated_at, resumed_from, scope) \
                 VALUES ('{run_id}', '{}', 'codex', 'running', '2026-08-19T15:00:00Z', {provider}, 'working', '2026-08-19T15:00:00Z', {predecessor}, 'task')",
                compact(TASK_ID),
            ),
        ))
        .await
        .unwrap();
}

async fn insert_ended_scratch_run(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    provider_session_id: &str,
    scope: &str,
) {
    let namespace = ticketry_terminal::current_runtime_namespace().unwrap();
    let sql = format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, lifecycle_state, lifecycle_updated_at, scope) \
         VALUES ('{run_id}', '{}', 'codex', 'completed', '2026-08-19T10:00:00Z', '2026-08-19T14:00:00Z', '{provider_session_id}', 'exited', '2026-08-19T14:00:00Z', '{scope}'); \
         INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) \
         VALUES ('{run_id}', 'pt-{run_id}', '{}', '{}', '{}', '2026-08-19T10:00:00Z', '2026-08-19T14:00:00Z', '{scope}', 0, '{namespace}', 0, 'codex');",
        compact(TASK_ID),
        compact(ticketry_documents::SCRATCH_TASK_ID),
        compact(MODULE_ID),
        compact(PROJECT_ID),
    );
    database.execute_unprepared(&sql).await.unwrap();
}

fn compact(value: &str) -> String {
    value.replace('-', "")
}
