//! The in-process WorkTracker MCP listener external agents connect to. It is
//! optional: the desktop stays usable when its port cannot be bound.

use std::path::Path;

use crate::desktop::environment::{optional_port, DEVELOPMENT_MCP_PORT_ENV};
use crate::desktop::service_state::DesktopServiceState;
use crate::ownership::established_data_directory;
use crate::supervisor::Supervisor;
use crate::work_management;

/// External MCP clients get one stable endpoint in both development and
/// packaged launches.
pub(crate) const WORKTRACKER_MCP_PORT: u16 = 8123;

pub(crate) fn configured_mcp_port() -> Result<u16, String> {
    optional_port(DEVELOPMENT_MCP_PORT_ENV).map(|port| port.unwrap_or(WORKTRACKER_MCP_PORT))
}

pub(crate) async fn start_in_process_mcp(
    data_directory: &Path,
    backend_port: u16,
    backend_api_key: &str,
    mcp_port: u16,
) -> Result<work_management::mcp::McpRuntime, String> {
    work_management::mcp::McpRuntime::start(work_management::mcp::McpConfiguration {
        address: work_management::mcp::loopback(mcp_port).map_err(|error| error.to_string())?,
        database_path: data_directory.join("state.db"),
        media_root: data_directory.join("media"),
        backend_base_url: format!("http://127.0.0.1:{backend_port}/api"),
        backend_api_key: backend_api_key.to_owned(),
    })
    .await
}

/// Restart the listener if it stopped while the backend kept serving. The
/// caller already holds the supervisor lock.
pub(crate) fn ensure_in_process_mcp(
    state: &DesktopServiceState,
    supervisor: &Supervisor,
) -> Result<(), String> {
    let mut runtime = state.mcp_runtime.lock().expect("MCP runtime lock poisoned");
    if runtime
        .as_ref()
        .is_some_and(work_management::mcp::McpRuntime::is_running)
    {
        return Ok(());
    }
    if let Some(stopped) = runtime.take() {
        tauri::async_runtime::block_on(stopped.shutdown());
    }
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let backend_port = supervisor
        .port()
        .ok_or_else(|| "backend is unavailable for WorkTracker MCP".to_owned())?;
    let mcp_port = configured_mcp_port()?;
    *runtime = Some(tauri::async_runtime::block_on(start_in_process_mcp(
        &data_directory,
        backend_port,
        supervisor.credential(),
        mcp_port,
    ))?);
    Ok(())
}
