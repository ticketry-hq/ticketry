mod common;

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::submitted_launch_authority::launch_service;
use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID,
};
use muxed_studio_lib::terminal::launch::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalRuntimeObservation,
    VerifiedTerminalRuntime,
};
use sea_orm::{ConnectionTrait, EntityTrait};
use ticketry_entities::terminals::{launch_material, session};
use ticketry_launch::terminal_session::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchKind,
};

struct ResumeRuntime {
    created: Mutex<BTreeSet<String>>,
}

#[async_trait]
impl TerminalLaunchRuntime for ResumeRuntime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.created.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("pt-{agent_run_id}"),
                runtime_namespace: muxed_studio_lib::tmux_adapter::current_runtime_namespace()
                    .unwrap(),
            })
        } else {
            TerminalRuntimeObservation::Missing
        }
    }

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        self.created
            .lock()
            .unwrap()
            .insert(material.agent_run_id.clone());
        Ok(())
    }
}

#[tokio::test]
async fn resume_creates_new_history_and_retries_idempotently() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_source(
        &database,
        "resume-source",
        "codex",
        Some("provider-session"),
        true,
    )
    .await;
    database
        .execute_unprepared(
            "UPDATE agent_terminal_sessions \
             SET runtime_namespace='tmux-source-installation', \
                 task_id='00000000-0000-0000-0000-000000008647', \
                 module_id='00000000-0000-0000-0000-000000009999', \
                 project_id='00000000-0000-0000-0000-000000008641' \
             WHERE agent_run_id='resume-source'",
        )
        .await
        .unwrap();
    let original = session::Entity::find_by_id("resume-source")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let original_run = ticketry_entities::runs::agent_run::Entity::find_by_id("resume-source")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let service = launch_service(
        database.clone(),
        Arc::new(ResumeRuntime {
            created: Mutex::new(BTreeSet::new()),
        }),
    );
    let request = resume_request("resume-request", "resume-source", TerminalLaunchKind::Task);

    let created = service.create(request.clone()).await.unwrap();
    let replayed = service.create(request).await.unwrap();

    assert_eq!(created, replayed);
    assert_ne!(created.agent_run_id, original.agent_run_id);
    assert_eq!(
        session::Entity::find_by_id("resume-source")
            .one(&database)
            .await
            .unwrap(),
        Some(original)
    );
    assert_eq!(
        ticketry_entities::runs::agent_run::Entity::find_by_id("resume-source")
            .one(&database)
            .await
            .unwrap(),
        Some(original_run)
    );
    let successor = ticketry_entities::runs::agent_run::Entity::find_by_id(&created.agent_run_id)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(successor.resumed_from.as_deref(), Some("resume-source"));
    assert!(created.terminated_at.is_none());
}

#[tokio::test]
async fn resume_rejections_have_stable_codes() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_source(&database, "sessionless", "codex", None, true).await;
    insert_source(
        &database,
        "unsupported",
        "unknown-provider",
        Some("unsupported-session"),
        true,
    )
    .await;
    insert_source(
        &database,
        "wrong-scope",
        "codex",
        Some("wrong-scope-session"),
        true,
    )
    .await;
    insert_source(
        &database,
        "already-resumed",
        "codex",
        Some("resumed-session"),
        true,
    )
    .await;
    insert_live_successor(&database, "already-resumed").await;
    insert_agentless_shell(&database, "agentless-shell").await;
    let service = launch_service(
        database,
        Arc::new(ResumeRuntime {
            created: Mutex::new(BTreeSet::new()),
        }),
    );

    for (source, kind, code) in [
        ("missing", TerminalLaunchKind::Task, "resume_unknown"),
        (
            "terminal-harness-task",
            TerminalLaunchKind::Task,
            "resume_active",
        ),
        (
            "sessionless",
            TerminalLaunchKind::Task,
            "resume_sessionless",
        ),
        (
            "unsupported",
            TerminalLaunchKind::Task,
            "resume_unsupported",
        ),
        (
            "wrong-scope",
            TerminalLaunchKind::Planning,
            "resume_wrong_scope",
        ),
        (
            "already-resumed",
            TerminalLaunchKind::Task,
            "resume_already_resumed",
        ),
        (
            "agentless-shell",
            TerminalLaunchKind::Task,
            "resume_agentless",
        ),
    ] {
        let error = service
            .create(resume_request(&format!("reject-{source}"), source, kind))
            .await
            .unwrap_err();
        assert_eq!(error.code_str(), code, "source {source}");
    }
}

#[tokio::test]
async fn scratch_resume_preserves_the_scratch_holding() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    insert_scratch_source(&database, "scratch-source").await;
    let service = launch_service(
        database,
        Arc::new(ResumeRuntime {
            created: Mutex::new(BTreeSet::new()),
        }),
    );

    let created = service
        .create(resume_request(
            "scratch-resume-request",
            "scratch-source",
            TerminalLaunchKind::Planning,
        ))
        .await
        .unwrap();

    assert_eq!(created.scope, "plan");
    assert_eq!(
        created.task_id,
        compact(ticketry_documents::SCRATCH_TASK_ID)
    );
    assert_eq!(created.module_id, compact(MODULE_ID));
    assert_eq!(created.project_id, compact(PROJECT_ID));
}

fn resume_request(id: &str, source: &str, kind: TerminalLaunchKind) -> CreateTerminalSession {
    let scratch = matches!(
        kind,
        TerminalLaunchKind::Planning | TerminalLaunchKind::Instant
    );
    CreateTerminalSession {
        client_request_id: id.to_owned(),
        project_id: PROJECT_ID.to_owned(),
        issue_id: TASK_ID.to_owned(),
        module_id: MODULE_ID.to_owned(),
        target_id: if scratch { MODULE_ID } else { TASK_ID }.to_owned(),
        kind,
        provider: Some(
            if source == "unsupported" {
                "unknown-provider"
            } else {
                "codex"
            }
            .to_owned(),
        ),
        model: Some("gpt-5".to_owned()),
        reasoning: Some("high".to_owned()),
        policy_reference: None,
        prompt: None,
        resume_from_agent_run_id: Some(source.to_owned()),
        automation_attempt_id: None,
        required_skills: Vec::new(),
        working_directory_identity: if scratch {
            format!("module:{}", compact(MODULE_ID))
        } else {
            format!("task:{}", compact(TASK_ID))
        },
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 40,
    }
}

async fn insert_source(
    database: &sea_orm::DatabaseConnection,
    run_id: &str,
    agent: &str,
    provider_session: Option<&str>,
    ended: bool,
) {
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    let provider = provider_session
        .map(|value| format!("'{value}'"))
        .unwrap_or_else(|| "NULL".to_owned());
    let end = ended.then_some("'2026-08-19T13:00:00Z'").unwrap_or("NULL");
    let sql = format!(
        "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, lifecycle_state, lifecycle_updated_at, scope) \
         VALUES ('{run_id}', '{}', '{agent}', 'completed', '2026-08-19T10:00:00Z', {end}, {provider}, 'exited', '2026-08-19T13:00:00Z', 'task'); \
         INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) \
         VALUES ('{run_id}', 'pt-{run_id}', '{}', '{}', '{}', '2026-08-19T10:00:00Z', {end}, 'task', 0, '{namespace}', 0, '{agent}');",
        compact(TASK_ID), compact(TASK_ID), compact(MODULE_ID), compact(PROJECT_ID),
    );
    database.execute_unprepared(&sql).await.unwrap();
}

async fn insert_live_successor(database: &sea_orm::DatabaseConnection, source: &str) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, lifecycle_state, lifecycle_updated_at, resumed_from, scope) \
             VALUES ('live-{source}', '{}', 'codex', 'running', '2026-08-19T14:00:00Z', 'working', '2026-08-19T14:00:00Z', '{source}', 'task')",
            compact(TASK_ID),
        ))
        .await
        .unwrap();
}

async fn insert_agentless_shell(database: &sea_orm::DatabaseConnection, run_id: &str) {
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, lifecycle_state, lifecycle_updated_at, scope) \
             VALUES ('{run_id}', '{}', NULL, 'completed', '2026-08-19T10:00:00Z', '2026-08-19T13:00:00Z', NULL, 'exited', '2026-08-19T13:00:00Z', 'shell'); \
             INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) \
             VALUES ('{run_id}', 'pt-{run_id}', '{}', '{}', '{}', '2026-08-19T10:00:00Z', '2026-08-19T13:00:00Z', 'shell', 0, '{namespace}', 0, NULL);",
            compact(MODULE_ID),
            compact(ticketry_documents::SCRATCH_TASK_ID),
            compact(MODULE_ID),
            compact(PROJECT_ID),
        ))
        .await
        .unwrap();
}

async fn insert_scratch_source(database: &sea_orm::DatabaseConnection, run_id: &str) {
    let namespace = muxed_studio_lib::tmux_adapter::current_runtime_namespace().unwrap();
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, ended_at, provider_session_id, lifecycle_state, lifecycle_updated_at, scope) \
             VALUES ('{run_id}', '{}', 'codex', 'completed', '2026-08-19T10:00:00Z', '2026-08-19T13:00:00Z', 'scratch-provider-session', 'exited', '2026-08-19T13:00:00Z', 'plan'); \
             INSERT INTO agent_terminal_sessions (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, terminated_at, scope, runtime_cleanup_pending, runtime_namespace, output_sequence, agent) \
             VALUES ('{run_id}', 'pt-{run_id}', '{}', '{}', '{}', '2026-08-19T10:00:00Z', '2026-08-19T13:00:00Z', 'plan', 0, '{namespace}', 0, 'codex');",
            compact(TASK_ID),
            compact(ticketry_documents::SCRATCH_TASK_ID),
            compact(MODULE_ID),
            compact(PROJECT_ID),
        ))
        .await
        .unwrap();
}

fn compact(value: &str) -> String {
    value.replace('-', "")
}
