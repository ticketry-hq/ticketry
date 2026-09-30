use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::process::{Child, Command};

const AUTHORIZATION: &str = "Bearer test-secret-never-print";

#[path = "mcp_bridge/fragmented_response.rs"]
mod fragmented_response;

#[path = "mcp_bridge/initialized_write_failure.rs"]
mod initialized_write_failure;

#[path = "mcp_bridge/repeated_initialize.rs"]
mod repeated_initialize;

fn bridge(directory: &TempDir) -> Child {
    Command::new(env!("CARGO_BIN_EXE_ticketry-hook"))
        .args([
            "mcp",
            "--data-dir",
            directory.path().to_str().unwrap(),
            "--agent-run-id",
            "run-123",
        ])
        .env("TICKETRY_MCP_AUTHORIZATION", AUTHORIZATION)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn bridge")
}

async fn line(reader: &mut (impl AsyncBufReadExt + Unpin)) -> Value {
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(2), reader.read_line(&mut line))
        .await
        .expect("line timeout")
        .expect("read line");
    serde_json::from_str(&line).expect("JSON line")
}

#[tokio::test]
async fn forwards_fragmented_and_concurrent_requests_with_original_ids() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut read = BufReader::new(read);
        assert_eq!(
            line(&mut read).await,
            json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-123", "authorization": AUTHORIZATION})
        );
        write
            .write_all(b"{\"ticketry_mcp_auth\":1,\"ok\":true}\n")
            .await
            .unwrap();

        let initialize = line(&mut read).await;
        assert_eq!(initialize["method"], "initialize");
        write.write_all(
            format!("{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{{\"tools\":{{}}}},\"serverInfo\":{{\"name\":\"ticketry\",\"version\":\"1\"}}}}}}\n", initialize["id"]).as_bytes()
        ).await.unwrap();
        assert_eq!(line(&mut read).await["method"], "notifications/initialized");
        assert_eq!(line(&mut read).await["method"], "notifications/cancelled");
        let first = line(&mut read).await;
        let second = line(&mut read).await;
        assert_eq!(first["id"], 7);
        assert_eq!(second["id"], "call-8");
        write.write_all(
            format!("{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"order\":2}}}}\n{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"order\":1}}}}\n", second["id"], first["id"]).as_bytes()
        ).await.unwrap();
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"init-1\",\"method\":\"init")
        .await
        .unwrap();
    input.write_all(b"ialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}}\n").await.unwrap();
    assert_eq!(line(&mut output).await["id"], "init-1");
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\",\"params\":{\"requestId\":\"old\"}}\n{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/list\"}\n{\"jsonrpc\":\"2.0\",\"id\":\"call-8\",\"method\":\"tools/call\"}\n").await.unwrap();
    let first_response = line(&mut output).await;
    assert_eq!(first_response["id"], "call-8", "{first_response}");
    let second_response = line(&mut output).await;
    assert_eq!(second_response["id"], 7, "{second_response}");

    drop(input);
    assert!(tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    server.await.unwrap();
}

async fn accept_authenticated(
    listener: &UnixListener,
) -> (
    BufReader<tokio::net::unix::OwnedReadHalf>,
    tokio::net::unix::OwnedWriteHalf,
) {
    let (stream, _) = listener.accept().await.unwrap();
    let (read, mut write) = stream.into_split();
    let mut read = BufReader::new(read);
    assert_eq!(line(&mut read).await["authorization"], AUTHORIZATION);
    write
        .write_all(b"{\"ticketry_mcp_auth\":1,\"ok\":true}\n")
        .await
        .unwrap();
    (read, write)
}

async fn initialize_server(
    read: &mut BufReader<tokio::net::unix::OwnedReadHalf>,
    write: &mut tokio::net::unix::OwnedWriteHalf,
    protocol: &str,
) -> Value {
    let request = line(read).await;
    write.write_all(
        format!("{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{{\"protocolVersion\":{protocol:?},\"capabilities\":{{\"tools\":{{}}}},\"serverInfo\":{{\"name\":\"ticketry\",\"version\":\"1\"}}}}}}\n", request["id"]).as_bytes()
    ).await.unwrap();
    request
}

async fn assert_credential_rejection_is_not_hot_retried(reason: &'static str) {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut read = BufReader::new(read);
        assert_eq!(line(&mut read).await["authorization"], AUTHORIZATION);
        write
            .write_all(
                format!("{{\"ticketry_mcp_auth\":1,\"ok\":false,\"reason\":{reason:?}}}\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_millis(1_100), listener.accept())
            .await
            .is_ok()
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input
        .write_all(
            b"{\"jsonrpc\":\"2.0\",\"id\":\"init\",\"method\":\"initialize\",\"params\":{}}\n",
        )
        .await
        .unwrap();
    let response = line(&mut output).await;
    assert_eq!(response["id"], "init");
    assert_eq!(response["error"]["data"]["code"], reason, "{response:#}");
    assert!(
        !server.await.unwrap(),
        "{reason} was retried within one second"
    );
    drop(input);
    assert!(child.wait().await.unwrap().success());
}

#[tokio::test]
async fn credential_rejections_preserve_the_reason_without_hot_reconnecting() {
    for reason in [
        "authorization_missing",
        "authorization_malformed",
        "authorization_expired",
        "authorization_invalid",
        "authorization_foreign_run",
        "caller_run_unknown",
    ] {
        assert_credential_rejection_is_not_hot_retried(reason).await;
    }
}

#[tokio::test]
async fn reconnects_replays_initialization_privately_and_never_replays_an_interrupted_call() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut first_read, mut first_write) = accept_authenticated(&listener).await;
        initialize_server(&mut first_read, &mut first_write, "2025-03-26").await;
        assert_eq!(
            line(&mut first_read).await["method"],
            "notifications/initialized"
        );
        let interrupted = line(&mut first_read).await;
        assert_eq!(interrupted["id"], "write-1");
        drop(first_read);
        drop(first_write);

        let (mut second_read, mut second_write) = accept_authenticated(&listener).await;
        let replay = initialize_server(&mut second_read, &mut second_write, "2025-03-26").await;
        assert_ne!(replay["id"], "init-1");
        assert_eq!(
            line(&mut second_read).await["method"],
            "notifications/initialized"
        );
        ready_tx.send(()).unwrap();
        let recovered = line(&mut second_read).await;
        assert_eq!(recovered["id"], 2);
        second_write
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ok\":true}}\n")
            .await
            .unwrap();
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"init-1\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    assert!(line(&mut output).await.get("result").is_some());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":\"write-1\",\"method\":\"tools/call\"}\n").await.unwrap();
    let uncertain = line(&mut output).await;
    assert_eq!(uncertain["id"], "write-1");
    assert_eq!(
        uncertain["error"]["data"]["code"],
        "execution_outcome_unknown"
    );
    ready_rx.await.unwrap();
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    let recovered = line(&mut output).await;
    assert_eq!(recovered["id"], 2);
    assert_eq!(recovered["result"]["ok"], true);

    drop(input);
    assert!(child.wait().await.unwrap().success());
    server.await.unwrap();
}

#[tokio::test]
async fn rejects_calls_when_a_restarted_server_is_incompatible() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut first_read, mut first_write) = accept_authenticated(&listener).await;
        initialize_server(&mut first_read, &mut first_write, "2025-03-26").await;
        line(&mut first_read).await;
        drop(first_read);
        drop(first_write);
        let (mut second_read, mut second_write) = accept_authenticated(&listener).await;
        initialize_server(&mut second_read, &mut second_write, "2099-01-01").await;
        ready_tx.send(()).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    line(&mut output).await;
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
        .await
        .unwrap();
    ready_rx.await.unwrap();
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"later\",\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    let response = line(&mut output).await;
    assert_eq!(response["id"], "later");
    assert_eq!(response["error"]["data"]["code"], "session_incompatible");
    drop(input);
    child.wait().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn unavailable_requests_are_correlated_and_credentials_are_never_printed() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    let started = tokio::time::Instant::now();
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"tools/list\"}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/cancelled\"}\n").await.unwrap();
    let response = line(&mut output).await;
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(response["id"], 99);
    assert_eq!(response["error"]["code"], -32001);
    assert!(
        tokio::time::timeout(Duration::from_millis(150), line(&mut output))
            .await
            .is_err()
    );
    drop(input);
    assert!(child.wait().await.unwrap().success());
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .await
        .unwrap();
    assert!(!stderr.contains(AUTHORIZATION));
}

#[tokio::test]
async fn rejects_an_oversized_message_without_losing_the_next_frame() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(&vec![b'x'; 1024 * 1024 + 1]).await.unwrap();
    input
        .write_all(b"\n{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    assert_eq!(
        line(&mut output).await["error"]["data"]["code"],
        "message_too_large"
    );
    assert_eq!(line(&mut output).await["id"], 5);
    drop(input);
    assert!(child.wait().await.unwrap().success());
}
