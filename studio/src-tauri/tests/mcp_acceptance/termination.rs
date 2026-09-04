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
use ticketry_entities::session;
use ticketry_mcp::post;
use ticketry_mcp::{allowed_provider_operations, loopback, McpConfiguration, McpRuntime};
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

async fn move_run_ticket_to_validation(url: &str, authorization: &str) {
    let response = post(
        url,
        Some(authorization),
        json!({
            "jsonrpc": "2.0",
            "id": 90,
            "method": "tools/call",
            "params": {
                "name": "update_task_status",
                "arguments": {
                    "project_id": "10000000-0000-0000-0000-000000000000",
                    "task_id": "AUTH-900",
                    "status_name": "Validation"
                }
            }
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let transitioned = &response["result"]["structuredContent"];
    assert_eq!(transitioned["ok"], true, "{transitioned}");
    assert_eq!(transitioned["status"], "Validation", "{transitioned}");
}

#[tokio::test]
async fn ticket_run_cannot_terminate_before_reaching_a_configured_destination_state() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            address: loopback(0).unwrap(),
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
            ingress_credential: "fixture-key".to_owned(),
        },
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let response = post(
        &format!("http://{}/mcp", runtime.address()),
        Some(&authorization),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "terminate_current_run", "arguments": {}}
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let rejected = &response["result"]["structuredContent"];
    assert_eq!(rejected["ok"], false, "{rejected}");
    assert_eq!(
        rejected["error"], "ticket_transition_required",
        "{rejected}"
    );
    assert_eq!(rejected["launch_state"], "Building", "{rejected}");
    assert_eq!(rejected["current_state"], "Building", "{rejected}");
    assert_eq!(terminal_record(&directory).await, (None, 0));

    let url = format!("http://{}/mcp", runtime.address());
    move_run_ticket_to_validation(&url, &authorization).await;
    let response = post(
        &url,
        Some(&authorization),
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "terminate_current_run", "arguments": {}}
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let accepted = &response["result"]["structuredContent"];
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["termination_requested"], true, "{accepted}");
    assert_eq!(wait_for_terminal_record(&directory).await.1, 1);

    runtime.shutdown().await;
}

#[tokio::test]
async fn terminate_current_run_survives_an_mcp_listener_restart() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    let configuration = McpConfiguration {
        address: loopback(0).unwrap(),
        database_path: directory.path().join("state.db"),
        media_root: directory.path().join("media"),
        ingress_credential: "fixture-key".to_owned(),
    };
    let first = McpRuntime::start_for_test(configuration.clone(), Arc::new(MissingTerminalRuntime))
        .await
        .unwrap();
    let authorization = first
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    move_run_ticket_to_validation(&format!("http://{}/mcp", first.address()), &authorization).await;
    first.shutdown().await;

    let second = McpRuntime::start_for_test(configuration, Arc::new(MissingTerminalRuntime))
        .await
        .unwrap();
    let response = post(
        &format!("http://{}/mcp", second.address()),
        Some(&authorization),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "terminate_current_run", "arguments": {}}
        }),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let terminated = &response["result"]["structuredContent"];
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
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            address: loopback(0).unwrap(),
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
            ingress_credential: "fixture-key".to_owned(),
        },
        terminal.clone(),
    )
    .await
    .unwrap();
    let authorization = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let url = format!("http://{}/mcp", runtime.address());
    move_run_ticket_to_validation(&url, &authorization).await;
    let mut request = tokio::spawn(async move {
        post(
            &url,
            Some(&authorization),
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "terminate_current_run", "arguments": {}}
            }),
        )
        .await
        .json::<Value>()
        .await
        .unwrap()
    });

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
