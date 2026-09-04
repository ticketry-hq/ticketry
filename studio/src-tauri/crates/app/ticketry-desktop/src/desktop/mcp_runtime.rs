//! The in-process WorkTracker MCP listener external agents connect to. The
//! desktop and local shells stay usable when its port cannot be bound, but
//! provider launches remain blocked.

use crate::desktop::environment::{optional_port, DEVELOPMENT_MCP_PORT_ENV};
use std::net::SocketAddr;
use std::path::Path;

const DEFAULT_MCP_PORT_START: u16 = 8123;
const DEFAULT_MCP_PORT_END: u16 = 8132;

pub(crate) fn configured_mcp_ports() -> Result<std::ops::RangeInclusive<u16>, String> {
    if cfg!(debug_assertions) {
        optional_port(DEVELOPMENT_MCP_PORT_ENV).map(selected_mcp_ports)
    } else {
        Ok(selected_mcp_ports(None))
    }
}

fn selected_mcp_ports(development_override: Option<u16>) -> std::ops::RangeInclusive<u16> {
    match development_override {
        Some(port) => port..=port,
        None => DEFAULT_MCP_PORT_START..=DEFAULT_MCP_PORT_END,
    }
}

pub fn owned_mcp_url(listener_address: Option<SocketAddr>) -> Option<String> {
    listener_address.map(|address| format!("http://{address}/mcp"))
}

#[cfg(test)]
mod tests {
    use super::{owned_mcp_url, selected_mcp_ports, start_in_process_mcp};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    static DEFAULT_PORT_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    async fn occupy_default_port(port: u16) -> Option<tokio::net::TcpListener> {
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => Some(listener),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => None,
            Err(error) => panic!("could not occupy default MCP port {port}: {error}"),
        }
    }

    #[test]
    fn desktop_uses_the_ordered_default_range_and_keeps_an_override_exact() {
        assert_eq!(
            selected_mcp_ports(None).collect::<Vec<_>>(),
            (8123..=8132).collect::<Vec<_>>()
        );
        assert_eq!(
            selected_mcp_ports(Some(43_219)).collect::<Vec<_>>(),
            vec![43_219]
        );
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

    #[tokio::test]
    async fn default_desktop_listener_rotates_from_8123_to_8124_then_8125() {
        let _port_test = DEFAULT_PORT_TEST_LOCK.lock().await;
        let directory = tempfile::tempdir().unwrap();
        std::fs::File::create(directory.path().join("state.db")).unwrap();
        let _port_8123 = occupy_default_port(8123).await;
        let available_8124 = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 8124))
            .await
            .expect("default MCP port 8124 must be available for this test");
        drop(available_8124);

        let runtime = start_in_process_mcp(
            directory.path(),
            "fixture-key",
            selected_mcp_ports(None),
            None,
        )
        .await
        .unwrap();
        assert_eq!(runtime.address().port(), 8124);
        runtime.shutdown().await;

        let _port_8124 = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 8124))
            .await
            .unwrap();
        let available_8125 = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 8125))
            .await
            .expect("default MCP port 8125 must be available for this test");
        drop(available_8125);
        let runtime = start_in_process_mcp(
            directory.path(),
            "fixture-key",
            selected_mcp_ports(None),
            None,
        )
        .await
        .unwrap();
        assert_eq!(runtime.address().port(), 8125);
        runtime.shutdown().await;
    }

    #[tokio::test]
    async fn occupied_development_override_fails_without_trying_another_port() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::File::create(directory.path().join("state.db")).unwrap();
        let occupied = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = occupied.local_addr().unwrap().port();

        let failure = start_in_process_mcp(
            directory.path(),
            "fixture-key",
            selected_mcp_ports(Some(port)),
            None,
        )
        .await
        .err()
        .expect("an occupied override must fail");

        assert!(failure.is_address_in_use());
    }

    #[tokio::test]
    async fn desktop_stops_after_default_port_8132_is_occupied() {
        let _port_test = DEFAULT_PORT_TEST_LOCK.lock().await;
        let directory = tempfile::tempdir().unwrap();
        std::fs::File::create(directory.path().join("state.db")).unwrap();
        let mut listeners = Vec::new();
        for port in 8123..=8132 {
            listeners.push(occupy_default_port(port).await);
        }

        let failure = start_in_process_mcp(
            directory.path(),
            "fixture-key",
            selected_mcp_ports(None),
            None,
        )
        .await
        .err()
        .expect("the exhausted default MCP range must fail");

        assert!(failure.is_address_in_use());
    }
}

pub async fn start_in_process_mcp(
    data_directory: &Path,
    ingress_credential: &str,
    mcp_ports: impl IntoIterator<Item = u16>,
    terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
) -> Result<ticketry_mcp::McpRuntime, ticketry_mcp::McpStartupError> {
    let mut last_collision = None;
    for mcp_port in mcp_ports {
        let configuration = ticketry_mcp::McpConfiguration {
            address: ticketry_mcp::loopback(mcp_port).map_err(|error| {
                ticketry_mcp::McpStartupError::Other {
                    diagnostic: error.to_string(),
                }
            })?,
            database_path: data_directory.join("state.db"),
            media_root: data_directory.join("media"),
            ingress_credential: ingress_credential.to_owned(),
        };
        let attempt = match terminal_launch.clone() {
            Some(service) => {
                ticketry_mcp::McpRuntime::start_with_terminal_launch(configuration, service)
                    .await
            }
            None => ticketry_mcp::McpRuntime::start(configuration).await,
        };
        match attempt {
            Ok(runtime) => return Ok(runtime),
            Err(error) if error.is_address_in_use() => last_collision = Some(error),
            Err(error) => return Err(error),
        }
    }

    Err(
        last_collision.unwrap_or_else(|| ticketry_mcp::McpStartupError::Other {
            diagnostic: "no WorkTracker MCP listener ports were configured".to_owned(),
        }),
    )
}
