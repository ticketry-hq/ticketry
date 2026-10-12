//! The typed MCP tools, reached through the packaged `ticketry-hook mcp`
//! stdio bridge against a disposable listener.

use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[path = "../../../../tests/common/mcp_database.rs"]
mod mcp_database;

struct Bridge {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Bridge {
    async fn start(directory: &std::path::Path, credential: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
            .args(["mcp", "--data-dir", directory.to_str().unwrap()])
            .args(["--agent-run-id", "run-valid"])
            .env("TICKETRY_MCP_AUTHORIZATION", credential)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut bridge = Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            _child: child,
        };
        let initialized = bridge
            .request(
                json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{
                    "protocolVersion":"2025-03-26","capabilities":{},
                    "clientInfo":{"name":"typed-tools","version":"1"}
                }}),
            )
            .await;
        assert!(
            initialized["result"]["serverInfo"].is_object(),
            "{initialized}"
        );
        bridge
            .input
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
        bridge
    }

    async fn request(&mut self, message: Value) -> Value {
        self.input
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(5), self.output.read_line(&mut line))
            .await
            .expect("bridge response deadline")
            .unwrap();
        serde_json::from_str(&line).unwrap()
    }

    async fn structured(&mut self, id: u64, tool: &str, arguments: Value) -> Value {
        let response = self
            .request(json!({"jsonrpc":"2.0","id":id,"method":"tools/call",
                "params":{"name":tool,"arguments":arguments}}))
            .await;
        assert!(response.get("error").is_none(), "{tool}: {response:#}");
        response["result"]["structuredContent"].clone()
    }
}

#[tokio::test]
async fn typed_tools_answer_through_the_packaged_stdio_bridge() {
    let directory = tempfile::Builder::new()
        .prefix("ticketry-typed-")
        .tempdir_in("/tmp")
        .unwrap();
    mcp_database::prepare_command_database(&directory).await;
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &guard,
    )
    .await
    .unwrap();
    let credential = runtime
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    runtime
        .grant_for_test("run-valid", "listing", ["list_tasks".to_owned()], false)
        .await
        .unwrap();

    let mut granted = Bridge::start(directory.path(), &credential).await;
    let listed = granted
        .request(json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}))
        .await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 35, "{listed:#}");
    assert_eq!(tools[0]["name"], "mcp_ping");
    let details = tools
        .iter()
        .find(|tool| tool["name"] == "get_task_details")
        .unwrap();
    assert_eq!(
        details["inputSchema"],
        json!({"type":"object","properties":{"id_or_key":{"type":"string"}},"required":["id_or_key"]})
    );

    assert_eq!(
        granted.structured(2, "mcp_ping", json!({})).await,
        json!({"status": "ok", "server": "ticketry"})
    );
    let task = granted
        .structured(3, "get_task_details", json!({"id_or_key": "AUTH-900"}))
        .await;
    assert_eq!(task["result"]["name"], "Authenticated caller", "{task:#}");
    let malformed = granted
        .structured(4, "get_task_details", json!({"id_or_key": ["AUTH-900"]}))
        .await;
    assert_eq!(malformed["ok"], false, "{malformed:#}");
    assert_eq!(malformed["code"], "validation", "{malformed:#}");
    assert_eq!(malformed["field"], "id_or_key", "{malformed:#}");

    let mut listing = Bridge::start(directory.path(), "Bearer listing").await;
    let refused = listing
        .structured(5, "get_task_details", json!({"id_or_key": "AUTH-900"}))
        .await;
    assert_eq!(
        refused["reason"], "authorization_tool_disallowed",
        "{refused:#}"
    );
    let legacy = listing
        .structured(
            6,
            "list_tasks",
            json!({"project_id": ticketry_mcp::PROJECT}),
        )
        .await;
    assert!(legacy["result"].is_array(), "{legacy:#}");

    runtime.shutdown().await;
}
