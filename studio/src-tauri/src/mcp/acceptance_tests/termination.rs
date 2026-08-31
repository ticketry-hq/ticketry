use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::Notify;
use tokio::time::{timeout, Duration};

use super::{prepare_command_database, wait_for_terminal_record, MissingTerminalRuntime};
use crate::mcp::tests::post;
use crate::mcp::{allowed_provider_operations, loopback, McpConfiguration, McpRuntime};
use crate::terminal::cleanup::{
    CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupRuntime,
};
use ticketry_entities::terminals::session;

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
