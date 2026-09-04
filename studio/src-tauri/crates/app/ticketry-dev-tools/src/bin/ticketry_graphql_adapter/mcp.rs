use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;

use ticketry_mcp::{McpConfiguration, McpRuntime};

const DEFAULT_MCP_PORT: u16 = 8123;
const MCP_PORT_ENV: &str = "MUXED_DESKTOP_MCP_PORT";

pub async fn start(data_directory: &Path) -> Result<McpRuntime, String> {
    let port = configured_port()?;
    McpRuntime::start(McpConfiguration {
        address: SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
        ingress_credential: uuid::Uuid::new_v4().simple().to_string(),
    })
    .await
}

fn configured_port() -> Result<u16, String> {
    let Some(value) = std::env::var_os(MCP_PORT_ENV) else {
        return Ok(DEFAULT_MCP_PORT);
    };
    value
        .into_string()
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .ok_or_else(|| format!("{MCP_PORT_ENV} must be a valid TCP port (1-65535)"))
}
