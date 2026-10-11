use std::ffi::OsStr;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixListener;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[path = "mcp_global_bridge/authorization.rs"]
mod authorization;

#[path = "mcp_global_bridge/reconnect.rs"]
mod reconnect;

fn bridge(directory: &TempDir, authorization: Option<&OsStr>) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_ticketry-hook"));
    command
        .args([
            "mcp",
            "--data-dir",
            directory.path().to_str().unwrap(),
            "--global",
        ])
        .env_remove("TICKETRY_MCP_AUTHORIZATION")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(authorization) = authorization {
        command.env("TICKETRY_MCP_AUTHORIZATION", authorization);
    }
    command.spawn().expect("spawn global bridge")
}

async fn line(reader: &mut (impl AsyncBufReadExt + Unpin)) -> Value {
    let mut frame = String::new();
    tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut frame))
        .await
        .expect("protocol frame timeout")
        .expect("read protocol frame");
    serde_json::from_str(&frame).expect("stdout and socket frames must contain only JSON")
}

async fn send(writer: &mut (impl AsyncWriteExt + Unpin), message: Value) {
    let mut frame = serde_json::to_vec(&message).unwrap();
    frame.push(b'\n');
    writer.write_all(&frame).await.unwrap();
}

async fn accept_global(listener: &UnixListener) -> (BufReader<OwnedReadHalf>, OwnedWriteHalf) {
    let (stream, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
        .await
        .expect("global connection timeout")
        .unwrap();
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read);
    assert_eq!(
        line(&mut read).await,
        json!({"ticketry_mcp_auth": 1, "mode": "global"})
    );
    send(&mut write, json!({"ticketry_mcp_auth": 1, "ok": true})).await;
    (read, write)
}

fn initialize(id: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {},
        "clientInfo": {"name": "global-bridge-fixture", "version": "1"}
    }})
}

async fn initialize_server(
    read: &mut BufReader<OwnedReadHalf>,
    write: &mut OwnedWriteHalf,
) -> Value {
    let request = line(read).await;
    assert_eq!(request["method"], "initialize");
    send(
        write,
        json!({"jsonrpc": "2.0", "id": request["id"], "result": {
            "protocolVersion": "2025-03-26", "capabilities": {"tools": {}},
            "serverInfo": {"name": "ticketry", "version": "1"}
        }}),
    )
    .await;
    request
}

async fn finish(mut child: Child, input: ChildStdin, mut output: BufReader<ChildStdout>) {
    drop(input);
    assert!(tokio::time::timeout(Duration::from_secs(3), child.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    let mut trailing_stdout = String::new();
    output.read_to_string(&mut trailing_stdout).await.unwrap();
    assert!(
        trailing_stdout.is_empty(),
        "unexpected stdout: {trailing_stdout}"
    );
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .await
        .unwrap();
    assert!(stderr.is_empty(), "unexpected bridge diagnostic: {stderr}");
}

#[tokio::test]
async fn global_handshake_needs_no_authorization_and_keeps_stdout_protocol_only() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let server = tokio::spawn(async move {
        let (mut read, mut write) = accept_global(&listener).await;
        assert_eq!(
            initialize_server(&mut read, &mut write).await,
            initialize("init")
        );
        assert_eq!(line(&mut read).await["method"], "notifications/initialized");
        let request = line(&mut read).await;
        assert_eq!(request["method"], "tools/list");
        send(
            &mut write,
            json!({"jsonrpc": "2.0", "id": request["id"], "result": {"tools": []}}),
        )
        .await;
    });
    let mut child = bridge(&directory, None);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    send(&mut input, initialize("init")).await;
    let response = line(&mut output).await;
    assert_eq!(response["id"], "init");
    assert!(response.get("result").is_some());
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
    )
    .await;
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "id": "tools", "method": "tools/list"}),
    )
    .await;
    assert_eq!(
        line(&mut output).await,
        json!({"jsonrpc": "2.0", "id": "tools", "result": {"tools": []}})
    );
    server.await.unwrap();
    finish(child, input, output).await;
}
