use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{McpConfiguration, McpRuntime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

pub async fn runtime(directory: &Path, guard: &DataDirectoryGuard) -> McpRuntime {
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

pub struct Bridge {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Bridge {
    pub fn start(directory: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
            .args(["mcp", "--data-dir", directory.to_str().unwrap(), "--global"])
            .env_remove("TICKETRY_MCP_AUTHORIZATION")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        }
    }

    pub async fn initialize(&mut self) {
        let response = self.request(json!({"jsonrpc":"2.0","id":"init","method":"initialize","params":{
            "protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"global-acceptance","version":"1"}
        }})).await;
        assert!(response["result"]["serverInfo"].is_object(), "{response}");
        self.input
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
    }

    pub async fn request(&mut self, message: Value) -> Value {
        self.input
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
        let mut response = String::new();
        let read =
            tokio::time::timeout(Duration::from_secs(2), self.output.read_line(&mut response))
                .await
                .expect("bridge response deadline")
                .unwrap();
        assert_ne!(read, 0, "bridge closed stdout before responding");
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            response["id"], message["id"],
            "private initialization must not leak: {response}"
        );
        response
    }

    pub async fn call(&mut self, id: u64, tool: &str, arguments: Value) -> Value {
        self.request(json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":tool,"arguments":arguments}})).await
    }

    pub async fn recovered(&mut self, first_id: u64) {
        tokio::time::timeout(Duration::from_secs(5), async {
            for id in first_id.. {
                let response = self.call(id, "list_projects", json!({})).await;
                if response.get("error").is_none() {
                    let projects = response["result"]["structuredContent"]["result"]
                        .as_array()
                        .unwrap();
                    assert!(
                        projects
                            .iter()
                            .any(|row| row["id"] == ticketry_mcp::PROJECT),
                        "{response}"
                    );
                    return;
                }
                assert_eq!(response["error"]["code"], -32001, "{response}");
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("global bridge did not reconnect");
    }

    pub async fn close(self) {
        let Self {
            mut child,
            input,
            mut output,
        } = self;
        drop(input);
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(status.success(), "{status}");
        let mut stdout = String::new();
        output.read_to_string(&mut stdout).await.unwrap();
        assert!(stdout.is_empty(), "unsolicited stdout: {stdout}");
        let mut stderr = String::new();
        child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .await
            .unwrap();
        assert!(stderr.is_empty(), "unexpected stderr: {stderr}");
    }
}
