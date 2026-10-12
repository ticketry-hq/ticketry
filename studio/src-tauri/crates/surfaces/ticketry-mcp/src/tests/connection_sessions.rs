//! Sessions over one live listener: concurrent clients, reconnecting runs and
//! the readiness gate.

use super::*;

#[tokio::test]
async fn concurrent_clients_each_receive_their_own_responses() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let socket = runtime.socket_path().to_path_buf();

    let clients = (0..8).map(|index| {
        let socket = socket.clone();
        tokio::spawn(async move {
            let mut client = SocketClient::connect_global(&socket).await;
            let id = 100 + index;
            let response = client.call(id, "mcp_ping", json!({})).await;
            assert_eq!(response["id"], id, "{response}");
            assert_eq!(response["result"]["structuredContent"]["status"], "ok");
        })
    });
    for client in clients {
        client.await.unwrap();
    }

    runtime.shutdown().await;
}

#[tokio::test]
async fn a_reconnecting_run_is_authorized_again_from_the_persistent_grant_store() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    let ownership = own(directory.path());
    let first = start(directory.path(), &ownership).await;
    let authorization = first
        .authority()
        .issue("run-valid", allowed_provider_operations())
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(first.socket_path(), "run-valid", &authorization).await;
    assert_eq!(
        client.structured(1, "list_projects", json!({})).await["result"][0]["id"],
        PROJECT
    );
    first.shutdown().await;
    assert!(
        client.is_closed().await,
        "shutdown must end live connections"
    );

    let second = start(directory.path(), &ownership).await;
    let mut client =
        SocketClient::connect_run(second.socket_path(), "run-valid", &authorization).await;
    assert_eq!(
        client.structured(2, "list_projects", json!({})).await["result"][0]["id"],
        PROJECT
    );
    let (mut foreign, verdict) = SocketClient::handshake(
        second.socket_path(),
        json!({"ticketry_mcp_auth": 1, "mode": "run", "agent_run_id": "run-other", "authorization": authorization}),
    )
    .await;
    assert_eq!(verdict["reason"], "authorization_foreign_run");
    assert!(foreign.is_closed().await);
    second.shutdown().await;
}

#[tokio::test]
async fn listener_returns_structured_unavailable_until_runtime_reconciliation_finishes() {
    let directory = tempfile::tempdir().unwrap();
    prepare_projects(directory.path()).await;
    ticketry_settings::publish_readiness(
        directory.path(),
        &ticketry_settings::Slice2Readiness::unavailable(),
    )
    .expect("close readiness");
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    runtime
        .grant_for_test(
            "run-valid",
            "starting",
            allowed_provider_operations(),
            false,
        )
        .await
        .unwrap();

    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer starting").await;
    let response = client.structured(1, "list_projects", json!({})).await;
    assert_eq!(response["code"], "service_unavailable", "{response:#}");
    assert_eq!(response["phase"], "runtime-reconciliation");

    runtime.shutdown().await;
}
