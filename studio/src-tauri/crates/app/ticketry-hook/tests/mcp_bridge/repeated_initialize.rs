use super::*;

#[tokio::test]
async fn rejects_repeated_initialize_without_leaving_ready() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let server = tokio::spawn(async move {
        let (mut read, mut write) = accept_authenticated(&listener).await;
        initialize_server(&mut read, &mut write, "2025-03-26").await;
        assert_eq!(line(&mut read).await["method"], "notifications/initialized");
        let request = line(&mut read).await;
        assert_eq!(request["method"], "tools/list", "{request}");
        write
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"list\",\"result\":{\"tools\":[]}}\n")
            .await
            .unwrap();
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"init-1\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    assert!(line(&mut output).await.get("result").is_some());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":\"init-2\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    let repeated = line(&mut output).await;
    assert_eq!(repeated["id"], "init-2");
    assert_eq!(repeated["error"]["code"], -32600, "{repeated}");

    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"list\",\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    assert_eq!(line(&mut output).await["result"]["tools"], json!([]));

    drop(input);
    assert!(child.wait().await.unwrap().success());
    server.await.unwrap();
}
