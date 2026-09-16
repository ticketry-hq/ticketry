use super::*;

#[tokio::test]
async fn concurrent_provider_input_preserves_a_fragmented_server_response() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let (fragment_tx, fragment_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut read, mut write) = accept_authenticated(&listener).await;
        initialize_server(&mut read, &mut write, "2025-03-26").await;
        assert_eq!(line(&mut read).await["method"], "notifications/initialized");
        assert_eq!(line(&mut read).await["id"], 7);
        write
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":")
            .await
            .unwrap();
        fragment_tx.send(()).unwrap();
        assert_eq!(line(&mut read).await["id"], 8);
        write
            .write_all(b"{\"ok\":true}}\n{\"jsonrpc\":\"2.0\",\"id\":8,\"result\":{\"ok\":true}}\n")
            .await
            .unwrap();
    });
    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    assert!(line(&mut output).await.get("result").is_some());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/list\"}\n").await.unwrap();
    fragment_rx.await.unwrap();
    // Let the bridge consume the first fragment before another select branch wins.
    tokio::time::sleep(Duration::from_millis(100)).await;
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    for expected_id in [7, 8] {
        let response = line(&mut output).await;
        assert_eq!(response["id"], expected_id, "{response}");
        assert_eq!(response["result"]["ok"], true, "{response}");
    }
    drop(input);
    assert!(child.wait().await.unwrap().success());
    server.await.unwrap();
}
