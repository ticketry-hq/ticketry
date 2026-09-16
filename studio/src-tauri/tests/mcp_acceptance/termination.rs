use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

use super::{
    prepare_command_database, terminal_record, wait_for_terminal_record, MissingTerminalRuntime,
};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_entities::session;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient};
use ticketry_terminal::{CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime};

struct BlockingTerminalRuntime {
    kill_started: Notify,
    release_kill: Notify,
    killed: AtomicBool,
}

impl BlockingTerminalRuntime {
    fn new() -> Self {
        Self {
            kill_started: Notify::new(),
            release_kill: Notify::new(),
            killed: AtomicBool::new(false),
        }
    }
}

#[async_trait]
impl TerminalCleanupRuntime for BlockingTerminalRuntime {
    async fn inspect(&self, _: &session::Model) -> CleanupRuntimeObservation {
        if self.killed.load(Ordering::Acquire) {
            CleanupRuntimeObservation::Missing
        } else {
            CleanupRuntimeObservation::Running
        }
    }

    async fn kill_verified(&self, _: &session::Model) -> CleanupKillResult {
        self.kill_started.notify_one();
        self.release_kill.notified().await;
        self.killed.store(true, Ordering::Release);
        CleanupKillResult::Killed
    }
}

fn configuration(directory: &tempfile::TempDir) -> McpConfiguration {
    McpConfiguration {
        database_path: directory.path().join("state.db"),
        media_root: directory.path().join("media"),
    }
}

async fn move_run_ticket_to_validation(client: &mut SocketClient) {
    let transitioned = client
        .structured(
            90,
            "update_task_status",
            json!({
                "project_id": "10000000-0000-0000-0000-000000000000",
                "task_id": "AUTH-900",
                "status_name": "Validation"
            }),
        )
        .await;
    assert_eq!(transitioned["ok"], true, "{transitioned}");
    assert_eq!(transitioned["status"], "Validation", "{transitioned}");
}

#[tokio::test]
async fn ticket_run_cannot_terminate_before_reaching_a_configured_destination_state() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        configuration(&directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", &authorization).await;
    let rejected = client
        .structured(1, "terminate_current_run", json!({}))
        .await;
    assert_eq!(rejected["ok"], false, "{rejected}");
    assert_eq!(
        rejected["error"], "ticket_transition_required",
        "{rejected}"
    );
    assert_eq!(rejected["launch_state"], "Building", "{rejected}");
    assert_eq!(rejected["current_state"], "Building", "{rejected}");
    assert_eq!(
        rejected["allowed_states"],
        json!(["Validation"]),
        "{rejected}"
    );
    assert!(
        rejected["detail"]
            .as_str()
            .is_some_and(|detail| detail.contains("Validation")),
        "{rejected}"
    );
    assert_eq!(terminal_record(&directory).await, (None, 0));

    move_run_ticket_to_validation(&mut client).await;
    let accepted = client
        .structured(2, "terminate_current_run", json!({}))
        .await;
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["termination_requested"], true, "{accepted}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_handoff_keeps_the_run_alive_for_its_queued_destination_prompt() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    amend_fixture(
        &directory,
        "UPDATE agent_runs SET started_at = '2026-01-01T00:00:00Z' WHERE id = 'run-valid'; \
         UPDATE worktracker_issuetypetransition SET handoff = 1 \
         WHERE from_state_id = '40000000000000000000000000000003';",
    )
    .await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        configuration(&directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", &authorization).await;

    move_run_ticket_to_validation(&mut client).await;
    let continued = client
        .structured(2, "terminate_current_run", json!({}))
        .await;

    assert_eq!(continued["ok"], true, "{continued}");
    assert_eq!(continued["continued_by_handoff"], true, "{continued}");
    assert_eq!(continued["termination_requested"], false, "{continued}");
    assert_eq!(terminal_record(&directory).await, (None, 0));

    runtime.shutdown().await;
}

#[tokio::test]
async fn terminate_current_run_survives_an_mcp_listener_restart() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let first = McpRuntime::start_for_test(
        configuration(&directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let authorization = first
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(first.socket_path(), "run-valid", &authorization).await;
    move_run_ticket_to_validation(&mut client).await;
    first.shutdown().await;

    let second = McpRuntime::start_for_test(
        configuration(&directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let mut client =
        SocketClient::connect_run(second.socket_path(), "run-valid", &authorization).await;
    let terminated = client
        .structured(1, "terminate_current_run", json!({}))
        .await;
    assert_eq!(terminated["ok"], true, "{terminated}");
    assert_eq!(terminated["agent_run_id"], "run-valid", "{terminated}");
    assert_eq!(terminated["termination_requested"], true, "{terminated}");
    assert_eq!(terminated["terminated"], false, "{terminated}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);

    second.shutdown().await;
}

#[tokio::test]
async fn terminate_current_run_responds_before_stopping_its_caller() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let terminal = Arc::new(BlockingTerminalRuntime::new());
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime =
        McpRuntime::start_for_test(configuration(&directory), &ownership, terminal.clone())
            .await
            .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", &authorization).await;
    move_run_ticket_to_validation(&mut client).await;
    let mut request =
        tokio::spawn(async move { client.call(1, "terminate_current_run", json!({})).await });

    let response = match timeout(Duration::from_secs(1), &mut request).await {
        Ok(response) => response.unwrap(),
        Err(_) => {
            terminal.release_kill.notify_one();
            let _ = request.await;
            panic!("termination stopped the caller before returning its MCP response");
        }
    };
    let requested = &response["result"]["structuredContent"];
    assert_eq!(requested["ok"], true, "{requested}");
    assert_eq!(requested["termination_requested"], true, "{requested}");
    timeout(Duration::from_secs(1), terminal.kill_started.notified())
        .await
        .expect("background cleanup did not start");
    terminal.release_kill.notify_one();
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);

    runtime.shutdown().await;
}

/// Rewrite the fixture before the listener opens, so a gate branch that no
/// caller could satisfy can be exercised end to end.
async fn amend_fixture(directory: &tempfile::TempDir, statement: &str) {
    use sea_orm::ConnectionTrait;
    let database = sea_orm::Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open MCP command fixture");
    database
        .execute_unprepared(statement)
        .await
        .expect("amend MCP command fixture");
    database.close().await.expect("close MCP command fixture");
}

async fn terminate_after(directory: &tempfile::TempDir, statement: &str) -> Value {
    prepare_command_database(directory).await;
    amend_fixture(directory, statement).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        configuration(directory),
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", &authorization).await;
    let accepted = client
        .structured(1, "terminate_current_run", json!({}))
        .await;
    runtime.shutdown().await;
    accepted
}

#[tokio::test]
async fn a_run_without_a_recorded_launch_state_still_terminates() {
    let directory = tempfile::tempdir().unwrap();
    let accepted = terminate_after(
        &directory,
        "UPDATE agent_runs SET launch_state = NULL WHERE id = 'run-valid';",
    )
    .await;
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["termination_requested"], true, "{accepted}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);
}

#[tokio::test]
async fn a_renamed_launch_state_does_not_strand_the_run() {
    let directory = tempfile::tempdir().unwrap();
    let accepted = terminate_after(
        &directory,
        "UPDATE worktracker_state SET name = 'Building (retired)' \
         WHERE id = '40000000000000000000000000000003';",
    )
    .await;
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["termination_requested"], true, "{accepted}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);
}

#[tokio::test]
async fn a_launch_state_with_no_configured_destination_does_not_strand_the_run() {
    let directory = tempfile::tempdir().unwrap();
    let accepted = terminate_after(
        &directory,
        "DELETE FROM worktracker_issuetypetransition \
         WHERE from_state_id = '40000000000000000000000000000003';",
    )
    .await;
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["termination_requested"], true, "{accepted}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);
}
