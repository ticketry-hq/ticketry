//! The in-process WorkTracker MCP listener external agents connect to. The
//! desktop and local shells stay usable when its port cannot be bound, but
//! provider launches remain blocked.

use crate::desktop::environment::{optional_port, DEVELOPMENT_MCP_PORT_ENV};
use std::net::SocketAddr;
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

pub(crate) fn owned_mcp_url(listener_address: Option<SocketAddr>) -> Option<String> {
    listener_address.map(|address| format!("http://{address}/mcp"))
}

#[cfg(test)]
mod tests {
    use super::{owned_mcp_url, selected_mcp_port};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    #[test]
    fn desktop_uses_the_global_mcp_port_by_default() {
        assert_eq!(selected_mcp_port(None), 8123);
        assert_eq!(selected_mcp_port(Some(43_219)), 43_219);
    }

    #[test]
    fn failed_listener_has_no_fallback_mcp_url() {
        assert_eq!(owned_mcp_url(None), None);
    }

    #[test]
    fn recovered_listener_uses_only_its_bound_endpoint() {
        let owned_address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 43_219);

        assert_eq!(
            owned_mcp_url(Some(owned_address)).as_deref(),
            Some("http://127.0.0.1:43219/mcp")
        );
    }
}

pub(crate) async fn start_in_process_mcp(
    data_directory: &Path,
    ingress_credential: &str,
    mcp_port: u16,
    terminal_launch: Option<ticketry_terminal::terminal::launch::TerminalLaunchService>,
) -> Result<crate::mcp::McpRuntime, String> {
    let configuration = crate::mcp::McpConfiguration {
        address: crate::mcp::loopback(mcp_port).map_err(|error| error.to_string())?,
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
        ingress_credential: ingress_credential.to_owned(),
    };
    match terminal_launch {
        Some(service) => {
            crate::mcp::McpRuntime::start_with_terminal_launch(configuration, service).await
        }
        None => crate::mcp::McpRuntime::start(configuration).await,
    }
}
