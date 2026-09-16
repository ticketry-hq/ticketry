use super::*;

#[tokio::test]
async fn recovers_when_the_initialized_notification_cannot_be_written() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let (disconnected_tx, disconnected_rx) = tokio::sync::oneshot::channel();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut read, mut write) = accept_authenticated(&listener).await;
        initialize_server(&mut read, &mut write, "2025-03-26").await;
        let stream = read
            .into_inner()
            .reunite(write)
            .unwrap()
            .into_std()
            .unwrap();
        // The disconnect and provider notification may arrive in either order;
        // both must preserve the notification for the replacement connection.
        drop(stream);
        disconnected_tx.send(()).unwrap();

        let (mut read, mut write) =
            tokio::time::timeout(Duration::from_secs(2), accept_authenticated(&listener))
                .await
                .expect("bridge reconnects after the failed notification write");
        let replay = initialize_server(&mut read, &mut write, "2025-03-26").await;
        assert_eq!(replay["method"], "initialize");
        assert_ne!(replay["id"], "init-1");
        assert_eq!(
            line(&mut read).await,
            json!({"jsonrpc":"2.0","method":"notifications/initialized","params":{"marker":"preserved"}})
        );
        ready_tx.send(()).unwrap();
        let request = line(&mut read).await;
        assert_eq!(request["id"], 7);
        assert_eq!(request["method"], "tools/list");
        write
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"tools\":[]}}\n")
            .await
            .unwrap();
    });

    let mut child = bridge(&directory);
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":\"init-1\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}\n").await.unwrap();
    let initialized = line(&mut output).await;
    assert_eq!(initialized["id"], "init-1");
    assert!(initialized.get("result").is_some());
    disconnected_rx.await.unwrap();
    input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\",\"params\":{\"marker\":\"preserved\"}}\n").await.unwrap();
    ready_rx
        .await
        .expect("server receives replayed initialization");
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/list\"}\n")
        .await
        .unwrap();
    assert_eq!(
        line(&mut output).await,
        json!({"jsonrpc":"2.0","id":7,"result":{"tools":[]}})
    );
    drop(input);
    assert!(tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    server.await.unwrap();
}
