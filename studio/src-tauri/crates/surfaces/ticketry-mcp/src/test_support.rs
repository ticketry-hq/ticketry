//! A line-oriented socket client shared by this crate's own tests and by the
//! root package's `mcp_acceptance` integration binary, which drives the
//! listener against the assembled GraphQL schema and therefore cannot live in
//! this crate. Compiled only for this crate's tests and for the `test-support`
//! feature that dev-dependencies turn on.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

pub const PROJECT: &str = "10000000-0000-0000-0000-000000000000";

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

/// One authenticated, initialized MCP connection over the data-directory socket.
pub struct SocketClient {
    reader: BufReader<tokio::net::unix::OwnedReadHalf>,
    writer: tokio::net::unix::OwnedWriteHalf,
}

impl SocketClient {
    /// Connect, send the handshake envelope, and return the verdict line
    /// without initializing MCP. Lets a test look at refusals directly.
    pub async fn handshake(socket: &Path, envelope: Value) -> (Self, Value) {
        let stream = UnixStream::connect(socket)
            .await
            .expect("connect to the WorkTracker MCP socket");
        let (read, writer) = stream.into_split();
        let mut client = Self {
            reader: BufReader::new(read),
            writer,
        };
        client
            .write_raw(&serde_json::to_string(&envelope).unwrap())
            .await;
        let verdict = client
            .read_line()
            .await
            .expect("read the handshake verdict");
        (client, verdict)
    }

    /// Whether the server closed the stream after its handshake verdict.
    pub async fn is_closed(&mut self) -> bool {
        self.read_line().await.is_none()
    }

    /// Connect as a provider bridge speaking for `agent_run_id` and finish
    /// MCP initialization.
    pub async fn connect_run(socket: &Path, agent_run_id: &str, authorization: &str) -> Self {
        Self::connect_initialized(
            socket,
            json!({
                "ticketry_mcp_auth": 1,
                "mode": "run",
                "agent_run_id": agent_run_id,
                "authorization": authorization,
            }),
        )
        .await
    }

    /// Connect as local tooling without a run and finish MCP initialization.
    pub async fn connect_global(socket: &Path) -> Self {
        Self::connect_initialized(socket, json!({"ticketry_mcp_auth": 1, "mode": "global"})).await
    }

    async fn connect_initialized(socket: &Path, envelope: Value) -> Self {
        let (mut client, verdict) = Self::handshake(socket, envelope).await;
        assert_eq!(verdict["ok"], true, "handshake refused: {verdict}");
        let initialized = client
            .request(json!({
                "jsonrpc": "2.0", "id": "init", "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "ticketry-test", "version": "0"}
                }
            }))
            .await;
        assert!(
            initialized["result"]["serverInfo"].is_object(),
            "{initialized}"
        );
        client
            .write_raw(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
            .await;
        client
    }

    /// Send one JSON-RPC request and return its response.
    pub async fn request(&mut self, message: Value) -> Value {
        self.write_raw(&serde_json::to_string(&message).unwrap())
            .await;
        self.read_line()
            .await
            .expect("the server closed the connection")
    }

    /// Call one WorkTracker tool and return the full JSON-RPC response.
    pub async fn call(&mut self, id: u64, name: &str, arguments: Value) -> Value {
        self.request(json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": {"name": name, "arguments": arguments}
        }))
        .await
    }

    /// Call one WorkTracker tool and return only its structured content.
    pub async fn structured(&mut self, id: u64, name: &str, arguments: Value) -> Value {
        self.call(id, name, arguments).await["result"]["structuredContent"].clone()
    }

    async fn write_raw(&mut self, line: &str) {
        self.writer
            .write_all(format!("{line}\n").as_bytes())
            .await
            .expect("write to the WorkTracker MCP socket");
    }

    async fn read_line(&mut self) -> Option<Value> {
        let mut line = String::new();
        let read = tokio::time::timeout(RESPONSE_TIMEOUT, self.reader.read_line(&mut line))
            .await
            .expect("the WorkTracker MCP socket did not answer in time")
            .expect("read from the WorkTracker MCP socket");
        (read > 0).then(|| serde_json::from_str(&line).expect("decode a JSON line"))
    }
}
