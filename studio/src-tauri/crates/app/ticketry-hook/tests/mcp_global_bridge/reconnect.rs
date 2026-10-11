use super::*;

#[tokio::test]
async fn recovers_from_offline_and_replays_only_session_initialization_after_disconnect() {
    let directory = tempfile::tempdir_in("/tmp").unwrap();
    let authorization = OsStr::new("Bearer global-secret-never-print");
    let mut child = bridge(&directory, Some(authorization));
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());

    let started = tokio::time::Instant::now();
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "id": "offline", "method": "tools/list"}),
    )
    .await;
    let unavailable = line(&mut output).await;
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(unavailable["id"], "offline");
    assert_eq!(unavailable["error"]["code"], -32001);
    assert_eq!(unavailable["error"]["data"]["code"], "service_unavailable");

    let started = tokio::time::Instant::now();
    send(&mut input, initialize("offline-initialize")).await;
    let unavailable = line(&mut output).await;
    assert!(started.elapsed() < Duration::from_millis(1_500));
    assert_eq!(unavailable["id"], "offline-initialize");
    assert_eq!(unavailable["error"]["code"], -32001);
    assert_eq!(unavailable["error"]["data"]["code"], "service_unavailable");

    let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut first_read, mut first_write) = accept_global(&listener).await;
        let first_initialize = initialize_server(&mut first_read, &mut first_write).await;
        assert_eq!(first_initialize, initialize("init"));
        let initialized = line(&mut first_read).await;
        assert_eq!(initialized["method"], "notifications/initialized");
        let interrupted = line(&mut first_read).await;
        assert_eq!(interrupted["id"], "write");
        assert_eq!(interrupted["method"], "tools/call");
        drop(first_read);
        drop(first_write);

        let (mut second_read, mut second_write) = accept_global(&listener).await;
        let replay = initialize_server(&mut second_read, &mut second_write).await;
        assert_ne!(replay["id"], first_initialize["id"]);
        assert_eq!(replay["params"], first_initialize["params"]);
        assert_eq!(line(&mut second_read).await, initialized);
        ready_tx.send(()).unwrap();
        let recovered = line(&mut second_read).await;
        assert_eq!(
            recovered["id"], "recovered",
            "interrupted calls must never replay"
        );
        assert_eq!(recovered["method"], "tools/list");
        send(
            &mut second_write,
            json!({"jsonrpc": "2.0", "id": "recovered", "result": {"tools": []}}),
        )
        .await;
    });

    send(&mut input, initialize("init")).await;
    let initialized = line(&mut output).await;
    assert_eq!(initialized["id"], "init");
    assert!(initialized.get("result").is_some());
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
    )
    .await;
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "id": "write", "method": "tools/call", "params": {
            "name": "update_task", "arguments": {"id": "fixture-task", "title": "changed once"}
        }}),
    )
    .await;
    let interrupted = line(&mut output).await;
    assert_eq!(interrupted["id"], "write");
    assert_eq!(interrupted["error"]["code"], -32001);
    assert_eq!(
        interrupted["error"]["data"]["code"],
        "execution_outcome_unknown"
    );
    tokio::time::timeout(Duration::from_secs(3), ready_rx)
        .await
        .unwrap()
        .unwrap();
    send(
        &mut input,
        json!({"jsonrpc": "2.0", "id": "recovered", "method": "tools/list"}),
    )
    .await;
    assert_eq!(
        line(&mut output).await,
        json!({"jsonrpc": "2.0", "id": "recovered", "result": {"tools": []}})
    );
    server.await.unwrap();
    finish(child, input, output).await;
}
