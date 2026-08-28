//! The in-process WorkTracker MCP listener external agents connect to. It is
//! optional: the desktop stays usable when its port cannot be bound.

use crate::desktop::environment::{optional_port, DEVELOPMENT_MCP_PORT_ENV};
use crate::work_management;
use std::path::Path;

const DEFAULT_MCP_PORT: u16 = 8123;

pub(crate) fn configured_mcp_port() -> Result<u16, String> {
    if cfg!(debug_assertions) {
        optional_port(DEVELOPMENT_MCP_PORT_ENV).map(selected_mcp_port)
    } else {
        Ok(DEFAULT_MCP_PORT)
    }
}

fn selected_mcp_port(development_override: Option<u16>) -> u16 {
    development_override.unwrap_or(DEFAULT_MCP_PORT)
}

#[cfg(test)]
mod tests {
    use super::selected_mcp_port;

    #[test]
    fn desktop_uses_the_global_mcp_port_by_default() {
        assert_eq!(selected_mcp_port(None), 8123);
        assert_eq!(selected_mcp_port(Some(43_219)), 43_219);
    }
}

pub(crate) async fn start_in_process_mcp(
    data_directory: &Path,
    ingress_credential: &str,
    mcp_port: u16,
    terminal_launch: Option<crate::terminal::launch::TerminalLaunchService>,
) -> Result<work_management::mcp::McpRuntime, String> {
    let configuration = work_management::mcp::McpConfiguration {
        address: work_management::mcp::loopback(mcp_port).map_err(|error| error.to_string())?,
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
        ingress_credential: ingress_credential.to_owned(),
    };
    match terminal_launch {
        Some(service) => {
            work_management::mcp::McpRuntime::start_with_terminal_launch(configuration, service)
                .await
        }
        None => work_management::mcp::McpRuntime::start(configuration).await,
    }
}
