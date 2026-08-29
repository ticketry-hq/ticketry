use std::thread;
use std::time::{Duration, Instant};

use muxed_studio_lib::terminal::viewer::attachment::{
    AttachmentOutcome, TerminalAttachment, TerminalAttachmentError,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

mod common;
use common::terminal_lifecycle_harness::{
    LifecycleBoundary, StopController, TerminalLifecycleHarness, DOCUMENT_PATH, DOCUMENT_RUN_ID,
    MODULE_ID, PROJECT_ID, TASK_ID, TASK_RUN_ID,
};

#[tokio::test]
async fn adopted_characterization_facts_and_public_graphql_survive_restart() {
    let mut harness = TerminalLifecycleHarness::start().await;
    let before = harness.terminal_facts().await;
    assert_eq!(before.len(), 2);
    let task = before
        .iter()
        .find(|fact| fact.agent_run_id == TASK_RUN_ID)
        .expect("task terminal fact");
    assert_eq!(task.tmux_session_name, format!("pt-{TASK_RUN_ID}"));
    assert_eq!(task.task_id, TASK_ID.replace('-', ""));
    assert_eq!(task.module_id, MODULE_ID.replace('-', ""));
    assert_eq!(task.project_id, PROJECT_ID.replace('-', ""));
    assert_eq!(
        task.runtime_namespace.as_deref(),
        Some(harness.runtime_namespace.as_str())
    );
    assert_eq!(task.scope, "task");
    assert!(task.doc_rel_path.is_none());
    assert!(task.terminated_at.is_none());

    let document = before
        .iter()
        .find(|fact| fact.agent_run_id == DOCUMENT_RUN_ID)
        .expect("document terminal fact");
    assert_eq!(document.scope, "docchat");
    assert_eq!(document.doc_rel_path.as_deref(), Some(DOCUMENT_PATH));

    let holdings = harness
        .graphql(
            "query($project: String!) { agent_run_holdings(project_id: $project) { agent_run_id task_id module_id scope state } }",
            serde_json::json!({"project": PROJECT_ID}),
        )
        .await;
    assert!(holdings.get("errors").is_none(), "{holdings:#}");
    assert_eq!(
        holdings["data"]["agent_run_holdings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        holdings["data"]["agent_run_holdings"][0]["agent_run_id"],
        TASK_RUN_ID
    );

    harness.restart().await;
    assert_eq!(harness.terminal_facts().await, before);
    let reopened = harness
        .graphql(
            "query($project: String!) { agent_run_holdings(project_id: $project) { agent_run_id scope state } }",
            serde_json::json!({"project": PROJECT_ID}),
        )
        .await;
    assert_eq!(
        reopened["data"]["agent_run_holdings"][0]["agent_run_id"],
        TASK_RUN_ID
    );
}

#[tokio::test]
async fn viewer_exit_is_not_hosted_command_exit_and_detach_preserves_tmux() {
    let harness = TerminalLifecycleHarness::start().await;
    harness
        .tmux
        .create_hosted(TASK_RUN_ID, "while :; do sleep 1; done");
    harness.tmux.create_hosted("hosted-exit", "exit 23");

    let viewer = TerminalAttachment::attach(TASK_RUN_ID, 80, 24).expect("attach viewer");
    assert_eq!(
        viewer.detach().expect("detach viewer"),
        AttachmentOutcome::Detached
    );
    assert!(harness.tmux.has_agent_run(TASK_RUN_ID));
    assert_eq!(harness.tmux.hosted_exit_code(TASK_RUN_ID), None);

    let deadline = Instant::now() + Duration::from_secs(5);
    let exit_code = loop {
        if let Some(code) = harness.tmux.hosted_exit_code("hosted-exit") {
            break code;
        }
        assert!(Instant::now() < deadline, "hosted command did not exit");
        thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(exit_code, 23);
    assert!(harness.tmux.has_agent_run("hosted-exit"));

    let missing = match TerminalAttachment::attach("missing-session", 80, 24) {
        Err(error) => error,
        Ok(_) => panic!("missing session must not attach"),
    };
    assert!(matches!(
        missing,
        TerminalAttachmentError::SessionNotFound { .. }
    ));
    assert_eq!(
        harness.tmux.inventory(),
        vec![
            ("pt-hosted-exit".to_owned(), "hosted-exit".to_owned()),
            (format!("pt-{TASK_RUN_ID}"), TASK_RUN_ID.to_owned()),
        ]
    );
}

#[tokio::test]
async fn named_boundary_stops_reopen_the_same_database_and_tmux_runtime() {
    let mut harness = TerminalLifecycleHarness::start().await;
    let durable = LifecycleBoundary::Durable("terminal_session_committed");
    let stop = StopController::at(durable.clone());
    let database = harness.database().await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE agent_terminal_sessions SET output_sequence=? WHERE agent_run_id=?",
            [864_i64.into(), TASK_RUN_ID.into()],
        ))
        .await
        .expect("commit durable boundary fact");
    assert_eq!(
        stop.checkpoint(durable.clone()),
        Err(common::terminal_lifecycle_harness::InjectedStop(durable))
    );
    drop(database);

    harness.restart().await;
    let database = harness.database().await;
    let sequence: i64 = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT output_sequence FROM agent_terminal_sessions WHERE agent_run_id=?",
            [TASK_RUN_ID.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "output_sequence")
        .unwrap();
    assert_eq!(sequence, 864);

    harness
        .tmux
        .create_hosted(TASK_RUN_ID, "while :; do sleep 1; done");
    let external = LifecycleBoundary::ExternalEffect("tmux_created");
    assert_eq!(
        StopController::at(external.clone()).checkpoint(external.clone()),
        Err(common::terminal_lifecycle_harness::InjectedStop(external))
    );
    drop(database);
    harness.restart().await;
    assert!(harness.tmux.has_agent_run(TASK_RUN_ID));
    assert_eq!(harness.terminal_facts().await.len(), 2);
}
