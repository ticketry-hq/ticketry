use std::future::IntoFuture;
use std::path::Path;

use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{McpConfiguration, McpRuntime};
use ticketry_terminal::{InstantRunTicketTitleService, TerminalLaunchService};

fn configuration(data_directory: &Path) -> McpConfiguration {
    McpConfiguration {
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
    }
}

/// Serve MCP with the same terminal launcher the browser's GraphQL launches
/// use, so launch tools start runs here exactly as they do on desktop.
pub async fn start(
    data_directory: &Path,
    ownership: &DataDirectoryGuard,
    terminal_launch: TerminalLaunchService,
    codex_titles: InstantRunTicketTitleService,
) -> Result<McpRuntime, String> {
    McpRuntime::start_with_terminal_launch(
        configuration(data_directory),
        ownership,
        terminal_launch,
        Some(codex_titles),
    )
    .await
    .map_err(|error| error.to_string())
}

pub async fn serve(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    runtime: McpRuntime,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let result = tokio::select! {
        result = axum::serve(listener, app).into_future() => result,
        _ = shutdown => Ok(()),
    };
    runtime.shutdown().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    #[tokio::test]
    async fn adapter_shutdown_closes_connections_and_removes_its_socket_before_returning() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::File::create(directory.path().join("state.db")).unwrap();
        let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
        let runtime = McpRuntime::start(configuration(directory.path()), &ownership)
            .await
            .unwrap();
        let socket = runtime.socket_path().to_path_buf();
        let mut connection = tokio::net::UnixStream::connect(&socket).await.unwrap();
        connection
            .write_all(b"{\"ticketry_mcp_auth\":1,\"mode\":\"global\"}\n")
            .await
            .unwrap();
        let mut connection = BufReader::new(connection);
        let mut verdict = String::new();
        connection.read_line(&mut verdict).await.unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&verdict).unwrap()["ok"],
            true
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();

        serve(listener, axum::Router::new(), runtime, async {})
            .await
            .unwrap();

        assert!(
            !socket.exists(),
            "adapter shutdown must remove its MCP socket"
        );
        let mut remaining = Vec::new();
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            connection.read_to_end(&mut remaining),
        )
        .await
        .expect("shutdown must close the connection")
        .unwrap();
        ownership.release().unwrap();
    }
}
