#![deny(private_bounds, private_interfaces)]

//! The in-process MCP tool listener: how a coding agent talks to Ticketry.
//!
//! An agent running inside a terminal reaches the product through one Unix
//! socket in the data directory, `mcp.sock`, that this crate serves as
//! newline-delimited JSON-RPC. [`McpRuntime`] binds it under the data
//! directory's ownership lease, and every connection opens with a private
//! authentication envelope naming the run it speaks for. [`RunAuthority`] —
//! minted where the run itself lives — resolves that credential on every tool
//! call into a [`RunPrincipal`]: which run is calling, for which work item,
//! and how far its scope reaches.
//!
//! What the listener exposes is composition, not model code. The registry
//! names the tools, dispatch turns one call into work-management commands,
//! graph runs, terminal launches or run termination, and projection renders
//! the answer back as the agent's own vocabulary. Nothing here owns a table;
//! it sits above the slices it dispatches into, which is why the schema is
//! assembled out of this crate rather than underneath it.

mod connection_handshake;
mod dependency_tools;
mod dispatch;
mod projection;
mod registry;
mod run_termination;
mod scope;
mod service;
mod socket_path;
mod termination_eligibility;
#[cfg(any(test, feature = "test-support"))]
mod test_support;
mod workflow_tools;

use std::path::PathBuf;

use rmcp::ServiceExt;
use tokio::net::UnixListener;
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

use ticketry_data_directory::DataDirectoryGuard;
use ticketry_work_management::{commands::attachments::AttachmentStorage, open_for_commands};

pub use registry::allowed_provider_operations;
use service::WorktrackerMcpService;
pub use socket_path::{mcp_socket_path, MCP_SOCKET_FILE_NAME};
pub use ticketry_runs::{RunAuthority, RunPrincipal};

// `test_support` is intentionally not a public module. Its fixture helpers
// are part of the explicit test-support facade so integration consumers can
// opt into them without exposing the MCP implementation tree.
#[cfg(any(test, feature = "test-support"))]
pub use test_support::{SocketClient, PROJECT};

#[derive(Clone, Debug)]
pub struct McpConfiguration {
    pub database_path: PathBuf,
    pub media_root: PathBuf,
}

impl McpConfiguration {
    fn data_directory(&self) -> PathBuf {
        self.database_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf()
    }
}

pub struct McpRuntime {
    socket_path: PathBuf,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
    authority: RunAuthority,
}

#[derive(Debug, Eq, PartialEq)]
pub enum McpStartupError {
    /// Another process still answers on the socket path.
    SocketInUse {
        diagnostic: String,
    },
    Other {
        diagnostic: String,
    },
}

impl McpStartupError {
    fn other(diagnostic: impl Into<String>) -> Self {
        Self::Other {
            diagnostic: diagnostic.into(),
        }
    }

    pub fn is_socket_in_use(&self) -> bool {
        matches!(self, Self::SocketInUse { .. })
    }

    pub fn diagnostic(&self) -> &str {
        match self {
            Self::SocketInUse { diagnostic } | Self::Other { diagnostic } => diagnostic,
        }
    }
}

impl std::fmt::Display for McpStartupError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.diagnostic())
    }
}

impl std::error::Error for McpStartupError {}

impl McpRuntime {
    /// Bind the data-directory socket. The caller proves it owns the data
    /// directory by lending its lease; the socket path is never inspected,
    /// reclaimed, or bound without one.
    pub async fn start(
        configuration: McpConfiguration,
        ownership: &DataDirectoryGuard,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(
            configuration,
            ownership,
            std::sync::Arc::new(ticketry_terminal::TmuxCleanupRuntime),
            None,
        )
        .await
    }

    pub async fn start_with_terminal_launch(
        configuration: McpConfiguration,
        ownership: &DataDirectoryGuard,
        terminal_launch: ticketry_terminal::TerminalLaunchService,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(
            configuration,
            ownership,
            std::sync::Arc::new(ticketry_terminal::TmuxCleanupRuntime),
            Some(terminal_launch),
        )
        .await
    }

    /// Starts the listener with both a caller-supplied terminal launch service
    /// and a caller-supplied cleanup runtime. `mcp_acceptance` needs the
    /// runtime seam; the kill-failure acceptance test needs both at once.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn start_for_test_with_terminal_launch(
        configuration: McpConfiguration,
        ownership: &DataDirectoryGuard,
        cleanup_runtime: std::sync::Arc<dyn ticketry_terminal::TerminalCleanupRuntime>,
        terminal_launch: ticketry_terminal::TerminalLaunchService,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(
            configuration,
            ownership,
            cleanup_runtime,
            Some(terminal_launch),
        )
        .await
    }

    /// Starts the listener against a caller-supplied terminal cleanup runtime.
    /// The root package's `mcp_acceptance` integration binary needs this seam,
    /// so it ships behind `test-support` as well as this crate's own tests.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn start_for_test(
        configuration: McpConfiguration,
        ownership: &DataDirectoryGuard,
        cleanup_runtime: std::sync::Arc<dyn ticketry_terminal::TerminalCleanupRuntime>,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(configuration, ownership, cleanup_runtime, None).await
    }

    async fn start_with_services(
        configuration: McpConfiguration,
        ownership: &DataDirectoryGuard,
        cleanup_runtime: std::sync::Arc<dyn ticketry_terminal::TerminalCleanupRuntime>,
        terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
    ) -> Result<Self, McpStartupError> {
        let data_directory = configuration.data_directory();
        let owned_directory = ownership
            .lock_path()
            .parent()
            .ok_or_else(|| McpStartupError::other("data-directory ownership has no directory"))?;
        let canonical = |path: &std::path::Path| {
            path.canonicalize().map_err(|error| {
                McpStartupError::other(format!(
                    "could not verify MCP data-directory ownership for {}: {error}",
                    path.display()
                ))
            })
        };
        if canonical(&data_directory)? != canonical(owned_directory)? {
            return Err(McpStartupError::other(
                "MCP startup requires ownership of the selected data directory",
            ));
        }
        verify_registry().map_err(McpStartupError::other)?;
        let database = open_for_commands(&configuration.database_path)
            .await
            .map_err(|error| {
                McpStartupError::other(format!(
                    "could not open WorkTracker commands for MCP: {error}"
                ))
            })?;
        let authority = RunAuthority::persistent(database.clone(), &data_directory)
            .map_err(McpStartupError::other)?;
        let socket_path = mcp_socket_path(&data_directory);
        let (listener, bound) = socket_path::bind(&socket_path).await?;
        let launch_policy =
            ticketry_work_management::launch_policy::LaunchPolicyResolver::new(database.clone());
        let graph_runs = terminal_launch.clone().map(|terminal_launch| {
            ticketry_agent_execution::GraphRunService::production(
                database.clone(),
                launch_policy.clone(),
                terminal_launch,
            )
        });
        let service = WorktrackerMcpService::new(
            database.clone(),
            AttachmentStorage::new(configuration.media_root),
            authority.clone(),
            launch_policy,
            graph_runs,
            ticketry_terminal::TerminalCleanupService::new(database, cleanup_runtime),
            terminal_launch,
            data_directory,
        );
        let cancellation = CancellationToken::new();
        let task = tokio::spawn(serve(
            listener,
            socket_path.clone(),
            bound,
            service,
            authority.clone(),
            cancellation.clone(),
        ));
        Ok(Self {
            socket_path,
            cancellation,
            task,
            authority,
        })
    }

    pub fn socket_path(&self) -> &std::path::Path {
        &self.socket_path
    }

    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    pub fn authority(&self) -> RunAuthority {
        self.authority.clone()
    }

    /// Mints a run credential without a live authorizer. Needed by the root
    /// package's `mcp_acceptance` integration binary as well as this crate's
    /// own tests, so it ships behind `test-support`.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn grant_for_test(
        &self,
        agent_run_id: &str,
        token: &str,
        allowed_tools: impl IntoIterator<Item = String>,
        expired: bool,
    ) -> Result<String, ticketry_runs::AuthorizationFailure> {
        self.authority
            .grant_for_test(agent_run_id, token, allowed_tools, expired)
            .await
    }

    /// Stop accepting, end every connection, and remove the socket this
    /// runtime created. Returns once the listener task has settled, so the
    /// caller may release data-directory ownership afterwards.
    pub async fn shutdown(mut self) {
        self.cancellation.cancel();
        let _ = (&mut self.task).await;
    }
}

/// Accept connections until cancelled; then wait for every connection task
/// and remove the socket if it is still ours.
async fn serve(
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

fn verify_registry() -> Result<(), String> {
    let tools = registry::tools();
    let unique = tools
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<std::collections::BTreeSet<_>>();
    if unique.len() != tools.len() {
        return Err("WorkTracker MCP registry contains duplicate tool names.".to_owned());
    }
    Ok(())
}

impl Drop for McpRuntime {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.task.abort();
    }
}

#[cfg(test)]
mod tests;
