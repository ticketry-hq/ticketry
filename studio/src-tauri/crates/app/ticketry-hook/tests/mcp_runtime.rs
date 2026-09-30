use std::process::Stdio;
use std::time::Duration;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[path = "../../../../tests/common/mcp_database.rs"]
mod mcp_database;

async fn runtime(directory: &std::path::Path, guard: &DataDirectoryGuard) -> McpRuntime {
    McpRuntime::start(
        McpConfiguration {
            database_path: directory.join("state.db"),
            media_root: directory.join("media"),
        },
        guard,
    )
    .await
    .unwrap()
}

struct Bridge {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Bridge {
    async fn start(directory: &std::path::Path, run: &str, credential: &str) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
            .args([
                "mcp",
                "--data-dir",
                directory.to_str().unwrap(),
                "--agent-run-id",
                run,
            ])
            .env("TICKETRY_MCP_AUTHORIZATION", credential)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut bridge = Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        };
        let initialized = bridge.request(json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{
            "protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"acceptance","version":"1"}
        }})).await;
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
        let mut response = String::new();
        tokio::time::timeout(Duration::from_secs(2), self.output.read_line(&mut response))
            .await
            .expect("bridge response deadline")
            .unwrap();
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            response["id"], message["id"],
            "private initialization must not leak: {response}"
        );
        response
    }

    async fn call(&mut self, id: u64, tool: &str, arguments: Value) -> Value {
        self.request(json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":tool,"arguments":arguments}})).await
    }

    async fn recovered(&mut self) {
        tokio::time::timeout(Duration::from_secs(5), async {
            for id in 100.. {
                let response = self
                    .call(
                        id,
                        "list_tasks",
                        json!({"project_id":ticketry_mcp::PROJECT}),
                    )
                    .await;
                if response.get("error").is_none() {
                    assert!(
                        response["result"]["structuredContent"]["result"].is_array(),
                        "{response}"
                    );
                    break;
                }
                assert_eq!(response["error"]["code"], -32001, "{response}");
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("bridge did not reconnect");
    }

    async fn close(self) {
        let Self {
            mut child, input, ..
        } = self;
        drop(input);
        assert!(tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .unwrap()
            .unwrap()
            .success());
    }
}

// Spawned only by the recovery case below; the parent kills this process.
#[tokio::test]
#[ignore = "isolated subprocess owned by bridges_survive_orderly_restart_and_sigkill"]
async fn runtime_process() {
    let directory =
        std::path::PathBuf::from(std::env::var_os("TICKETRY_RECOVERY_FIXTURE").unwrap());
    let guard = DataDirectoryGuard::acquire(&directory).unwrap();
    let _runtime = runtime(&directory, &guard).await;
    println!("MCP_FIXTURE_READY");
    std::future::pending::<()>().await;
}

#[tokio::test]
async fn bridges_survive_orderly_restart_and_sigkill_with_original_authority() {
    let _occupied_ports: Vec<_> = (8123..=8132)
        .filter_map(
            |port| match std::net::TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => Some(listener),
                Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => None,
                Err(error) => panic!("occupy historical MCP port {port}: {error}"),
            },
        )
        .collect();
    let directory = tempfile::Builder::new()
        .prefix("ticketry mcp '")
        .tempdir_in("/tmp")
        .unwrap();
    mcp_database::prepare_command_database(&directory).await;
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    database.execute_unprepared("INSERT INTO agent_runs (id,issue_id,agent,status,started_at,scope) VALUES
        ('run-second','30000000000000000000000000000000','claude','running',CURRENT_TIMESTAMP,'task'),
        ('run-third','30000000000000000000000000000000','gemini','running',CURRENT_TIMESTAMP,'task');").await.unwrap();
    database.close().await.unwrap();
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let first = runtime(directory.path(), &guard).await;
    let mut bridges = Vec::new();
    for run in ["run-valid", "run-second", "run-third"] {
        let credential = first
            .authority()
            .issue(run, allowed_provider_operations())
            .await
            .unwrap();
        bridges.push(Bridge::start(directory.path(), run, &credential).await);
    }
    first
        .grant_for_test("run-valid", "read-only", ["list_tasks".to_owned()], false)
        .await
        .unwrap();
    first
        .grant_for_test("run-valid", "expired", allowed_provider_operations(), true)
        .await
        .unwrap();
    let mut read_only = Bridge::start(directory.path(), "run-valid", "Bearer read-only").await;
    for bridge in &mut bridges {
        bridge.recovered().await;
    }
    let changed = bridges[0]
        .call(
            1,
            "update_task_status",
            json!({
                "project_id":ticketry_mcp::PROJECT,"task_id":"AUTH-900","status_name":"Validation"
            }),
        )
        .await;
    assert_eq!(
        changed["result"]["structuredContent"]["ok"], true,
        "{changed}"
    );
    let pids: Vec<_> = bridges.iter().map(|bridge| bridge.child.id()).collect();
    first.shutdown().await;
    drop(guard);
    for bridge in &mut bridges {
        let started = std::time::Instant::now();
        let outage = bridge
            .call(2, "list_tasks", json!({"project_id":ticketry_mcp::PROJECT}))
            .await;
        assert_eq!(outage["error"]["code"], -32001, "{outage}");
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    let mut server = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "runtime_process", "--ignored", "--nocapture"])
        .env("TICKETRY_RECOVERY_FIXTURE", directory.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut output = BufReader::new(server.stdout.take().unwrap());
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let mut line = String::new();
            assert_ne!(
                output.read_line(&mut line).await.unwrap(),
                0,
                "runtime exited before ready"
            );
            if line.contains("MCP_FIXTURE_READY") {
                break;
            }
        }
    })
    .await
    .unwrap();
    for bridge in &mut bridges {
        bridge.recovered().await;
    }
    read_only.recovered().await;
    server.kill().await.unwrap(); // Tokio sends SIGKILL on Unix.
    assert!(
        directory.path().join("mcp.sock").exists(),
        "SIGKILL must leave a stale socket"
    );
    let guard = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let restarted = runtime(directory.path(), &guard).await;
    let mut global = SocketClient::connect_global(restarted.socket_path()).await;
    assert_eq!(
        global.structured(1, "mcp_ping", json!({})).await["status"],
        "ok"
    );
    assert_eq!(
        global
            .structured(2, "terminate_current_run", json!({}))
            .await["reason"],
        "authorization_missing"
    );
    for bridge in &mut bridges {
        bridge.recovered().await;
    }
    read_only.recovered().await;
    let denied = read_only
        .call(
            3,
            "update_task_status",
            json!({
                "project_id":ticketry_mcp::PROJECT,"task_id":"AUTH-900","status_name":"Building"
            }),
        )
        .await;
    assert_eq!(
        denied["result"]["structuredContent"]["reason"], "authorization_tool_disallowed",
        "{denied}"
    );
    for (credential, run, reason) in [
        (Some("Bearer wrong"), "run-valid", "authorization_invalid"),
        (None, "run-valid", "authorization_missing"),
        (Some("Bearer expired"), "run-valid", "authorization_expired"),
        (
            Some("Bearer read-only"),
            "run-second",
            "authorization_foreign_run",
        ),
    ] {
        let (_, verdict) = SocketClient::handshake(
            restarted.socket_path(),
            json!({
                "ticketry_mcp_auth":1,"mode":"run","agent_run_id":run,"authorization":credential
            }),
        )
        .await;
        assert_eq!(verdict["reason"], reason, "{verdict}");
    }
    assert_eq!(
        bridges
            .iter()
            .map(|bridge| bridge.child.id())
            .collect::<Vec<_>>(),
        pids
    );
    for bridge in bridges {
        bridge.close().await;
    }
    read_only.close().await;
    restarted.shutdown().await;
}
