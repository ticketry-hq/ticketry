//! The in-process WorkTracker MCP listener external agents connect to, served
//! on the owned data directory's `mcp.sock`. The desktop and local shells stay
//! usable when it cannot start, but provider launches remain blocked.

use std::path::Path;

use ticketry_data_directory::DataDirectoryGuard;

pub async fn start_in_process_mcp(
    data_directory: &Path,
    ownership: &DataDirectoryGuard,
    terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
) -> Result<ticketry_mcp::McpRuntime, ticketry_mcp::McpStartupError> {
    let configuration = ticketry_mcp::McpConfiguration {
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
    };
    match terminal_launch {
        Some(service) => {
            ticketry_mcp::McpRuntime::start_with_terminal_launch(configuration, ownership, service)
                .await
        }
        None => ticketry_mcp::McpRuntime::start(configuration, ownership).await,
    }
}

#[cfg(test)]
mod tests {
    use super::start_in_process_mcp;
    use ticketry_data_directory::DataDirectoryGuard;

    #[tokio::test]
    async fn desktop_serves_the_socket_inside_its_owned_data_directory() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::File::create(directory.path().join("state.db")).unwrap();
        let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();

        let runtime = start_in_process_mcp(directory.path(), &ownership, None)
            .await
            .unwrap();

        assert_eq!(runtime.socket_path(), directory.path().join("mcp.sock"));
        runtime.shutdown().await;
    }
}
