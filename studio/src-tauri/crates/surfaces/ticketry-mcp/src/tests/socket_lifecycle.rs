//! Binding, reclaiming and removing the listener socket, and startup
//! failures that must stay explicit.

use super::*;

#[tokio::test]
async fn socket_is_bound_privately_inside_the_data_directory_and_removed_on_shutdown() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());

    let runtime = start(directory.path(), &ownership).await;

    let socket = runtime.socket_path().to_path_buf();
    assert_eq!(socket, directory.path().join("mcp.sock"));
    let metadata = std::fs::symlink_metadata(&socket).unwrap();
    assert!(std::os::unix::fs::FileTypeExt::is_socket(
        &metadata.file_type()
    ));
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    assert!(runtime.is_running());

    runtime.shutdown().await;
    assert!(
        !socket.exists(),
        "shutdown must remove the socket it created"
    );
}

#[tokio::test]
async fn shutdown_does_not_wait_for_an_unwritten_handshake() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let _client = tokio::net::UnixStream::connect(runtime.socket_path())
        .await
        .unwrap();
    tokio::task::yield_now().await;

    tokio::time::timeout(std::time::Duration::from_millis(500), runtime.shutdown())
        .await
        .expect("shutdown must cancel a pending socket handshake");
}

#[tokio::test]
async fn a_live_listener_is_not_displaced_by_a_second_start() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let first = start(directory.path(), &ownership).await;

    let failure = McpRuntime::start(configuration(directory.path()), &ownership)
        .await
        .err()
        .expect("a live socket must refuse a second listener");

    assert!(failure.is_socket_in_use(), "{failure}");
    assert!(matches!(failure, McpStartupError::SocketInUse { .. }));
    let mut client = SocketClient::connect_global(first.socket_path()).await;
    let pinged = client.structured(1, "mcp_ping", json!({})).await;
    assert_eq!(
        pinged["status"], "ok",
        "the first listener must keep serving"
    );
    first.shutdown().await;
}

#[tokio::test]
async fn a_guard_for_another_directory_cannot_reclaim_its_socket() {
    let owned = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    create_empty_database(foreign.path()).await;
    let ownership = own(owned.path());
    let socket = mcp_socket_path(foreign.path());
    drop(std::os::unix::net::UnixListener::bind(&socket).unwrap());
    use std::os::unix::fs::MetadataExt;
    let inode = std::fs::metadata(&socket).unwrap().ino();

    let result = McpRuntime::start(configuration(foreign.path()), &ownership).await;

    assert!(
        result.is_err(),
        "a foreign directory guard must refuse startup"
    );
    assert_eq!(std::fs::metadata(&socket).unwrap().ino(), inode);
}

#[tokio::test]
async fn a_stale_socket_is_reclaimed_but_a_non_socket_entry_is_left_alone() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let socket = mcp_socket_path(directory.path());
    // A socket whose owner died: bound, then abandoned without unlinking.
    let stale = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    drop(stale);
    assert!(socket.exists());

    let runtime = start(directory.path(), &ownership).await;
    let mut client = SocketClient::connect_global(runtime.socket_path()).await;
    assert_eq!(
        client.structured(1, "mcp_ping", json!({})).await["status"],
        "ok"
    );
    runtime.shutdown().await;

    std::fs::write(&socket, b"not a socket").unwrap();
    let failure = McpRuntime::start(configuration(directory.path()), &ownership)
        .await
        .err()
        .expect("a regular file on the socket path must fail startup");
    assert!(!failure.is_socket_in_use());
    assert!(
        failure.to_string().contains("non-socket entry"),
        "{failure}"
    );
    assert_eq!(std::fs::read(&socket).unwrap(), b"not a socket");
}

#[tokio::test]
async fn shutdown_removes_only_the_socket_this_runtime_created() {
    let directory = tempfile::tempdir().unwrap();
    create_empty_database(directory.path()).await;
    let ownership = own(directory.path());
    let runtime = start(directory.path(), &ownership).await;
    let socket = runtime.socket_path().to_path_buf();
    std::fs::remove_file(&socket).unwrap();
    let replacement = std::os::unix::net::UnixListener::bind(&socket).unwrap();

    runtime.shutdown().await;

    assert!(
        socket.exists(),
        "a replacement socket must survive our shutdown"
    );
    drop(replacement);
}

#[tokio::test]
async fn an_overlong_socket_path_is_an_explicit_startup_error() {
    let directory = tempfile::tempdir().unwrap();
    let deep = directory.path().join("x".repeat(120));
    std::fs::create_dir_all(&deep).unwrap();
    create_empty_database(&deep).await;
    let ownership = own(&deep);

    let failure = McpRuntime::start(configuration(&deep), &ownership)
        .await
        .err()
        .expect("an overlong socket path must fail");

    assert!(
        failure.to_string().contains("Unix sockets allow at most"),
        "{failure}"
    );
    assert!(!mcp_socket_path(&deep).exists());
}

#[tokio::test]
async fn database_startup_failure_retains_context_without_collision_classification() {
    let directory = tempfile::tempdir().unwrap();
    let ownership = own(directory.path());
    let invalid_database = directory.path().join("database-directory");
    std::fs::create_dir(&invalid_database).unwrap();

    let failure = match McpRuntime::start(
        McpConfiguration {
            database_path: invalid_database,
            media_root: directory.path().join("media"),
        },
        &ownership,
    )
    .await
    {
        Ok(_) => panic!("a directory cannot be opened as the MCP database"),
        Err(failure) => failure,
    };

    assert!(!failure.is_socket_in_use());
    assert!(matches!(failure, McpStartupError::Other { .. }));
    let diagnostic = failure.to_string();
    let detail = diagnostic
        .strip_prefix("could not open WorkTracker commands for MCP:")
        .unwrap_or_else(|| panic!("{diagnostic}"));
    assert!(!detail.trim().is_empty(), "{diagnostic}");
}
