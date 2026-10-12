//! Serving the bound socket: accept connections until cancelled, admit each
//! through the authentication handshake, then hand it to the MCP service.

use std::path::PathBuf;

use rmcp::ServiceExt;
use tokio::net::UnixListener;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use super::{connection_handshake, service::WorktrackerMcpService, socket_path, RunAuthority};

/// Accept connections until cancelled; then wait for every connection task
/// and remove the socket if it is still ours.
pub(super) async fn serve(
    listener: UnixListener,
    socket_path: PathBuf,
    bound: socket_path::BoundSocket,
    service: WorktrackerMcpService,
    authority: RunAuthority,
    cancellation: CancellationToken,
) {
    let mut connections = JoinSet::new();
    loop {
        let accepted = tokio::select! {
            _ = cancellation.cancelled() => break,
            accepted = listener.accept() => accepted,
        };
        let stream = match accepted {
            Ok((stream, _)) => stream,
            Err(error) => {
                eprintln!("Ticketry WorkTracker MCP socket accept failed: {error}");
                continue;
            }
        };
        connections.spawn(serve_connection(
            stream,
            service.clone(),
            authority.clone(),
            cancellation.child_token(),
        ));
        // Reap finished connections so the set does not grow with history.
        while connections.try_join_next().is_some() {}
    }
    drop(listener);
    while connections.join_next().await.is_some() {}
    socket_path::remove_own(&socket_path, bound);
}

async fn serve_connection(
    stream: tokio::net::UnixStream,
    service: WorktrackerMcpService,
    authority: RunAuthority,
    cancellation: CancellationToken,
) {
    let (read, mut write) = stream.into_split();
    let mut read = tokio::io::BufReader::new(read);
    let connection = tokio::select! {
        _ = cancellation.cancelled() => return,
        connection = connection_handshake::authenticate(&mut read, &mut write, &authority) => {
            let Ok(connection) = connection else { return };
            connection
        }
    };
    let running = match service
        .for_connection(connection)
        .serve_with_ct((read, write), cancellation)
        .await
    {
        Ok(running) => running,
        Err(rmcp::service::ServerInitializeError::Cancelled) => return,
        Err(error) => {
            eprintln!("Ticketry WorkTracker MCP connection did not initialize: {error}");
            return;
        }
    };
    let _ = running.waiting().await;
}
