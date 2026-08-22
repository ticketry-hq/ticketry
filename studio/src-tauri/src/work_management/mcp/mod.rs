//! In-process WorkTracker MCP transport owned by the desktop runtime.

mod backend_port;
mod dependency_tools;
mod dispatch;
mod launch_paths;
mod projection;
mod registry;
mod run_termination;
mod runs_lifecycle;
mod scope;
mod service;
mod terminal_launch_ingress;
mod workflow_tools;
mod worktree_integrations;

use std::{io, net::SocketAddr, path::PathBuf};

use axum::Router;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::{json, Value};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::work_management::{commands::attachments::AttachmentStorage, open_for_commands};

use backend_port::BackendPort;
use service::WorktrackerMcpService;

#[derive(Clone, Debug)]
pub struct McpConfiguration {
    pub address: SocketAddr,
    pub database_path: PathBuf,
    pub media_root: PathBuf,
    pub backend_base_url: String,
    pub backend_api_key: String,
}

pub struct McpRuntime {
    address: SocketAddr,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
    reconciler: JoinHandle<()>,
}

impl McpRuntime {
    pub async fn start(configuration: McpConfiguration) -> Result<Self, String> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(crate::terminal_cleanup::TmuxCleanupRuntime),
            None,
        )
        .await
    }

    pub async fn start_with_terminal_launch(
        configuration: McpConfiguration,
        terminal_launch: crate::terminal_launch::TerminalLaunchService,
    ) -> Result<Self, String> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(crate::terminal_cleanup::TmuxCleanupRuntime),
            Some(terminal_launch),
        )
        .await
    }

    #[cfg(test)]
    pub async fn start_for_test(
        configuration: McpConfiguration,
        cleanup_runtime: std::sync::Arc<dyn crate::terminal_cleanup::TerminalCleanupRuntime>,
    ) -> Result<Self, String> {
        Self::start_with_services(configuration, cleanup_runtime, None).await
    }

    async fn start_with_services(
        configuration: McpConfiguration,
        cleanup_runtime: std::sync::Arc<dyn crate::terminal_cleanup::TerminalCleanupRuntime>,
        terminal_launch: Option<crate::terminal_launch::TerminalLaunchService>,
    ) -> Result<Self, String> {
        if !configuration.address.ip().is_loopback() {
            return Err("WorkTracker MCP must bind to a loopback address.".to_owned());
        }
        let ingress_credential = configuration.backend_api_key.clone();
        let ingress_backend_base_url = configuration.backend_base_url.clone();
        let backend = BackendPort::new(
            configuration.backend_base_url,
            configuration.backend_api_key,
        );
        let database = open_for_commands(&configuration.database_path)
            .await
            .map_err(|error| format!("could not open WorkTracker commands for MCP: {error}"))?;
        let listener = tokio::net::TcpListener::bind(configuration.address)
            .await
            .map_err(|error| format!("could not bind WorkTracker MCP listener: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("could not inspect WorkTracker MCP listener: {error}"))?;
        let cancellation = CancellationToken::new();
        let ingress_database = database.clone();
        // One profile store for every capability on this listener, so a launch
        // policy decision and the directories that launch runs in are always
        // read from the same selected profile.
        let profiles = crate::settings_persistence::ProfileStore::new(
            configuration
                .database_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("profiles.json"),
        );
        let launch_paths_state = launch_paths::LaunchPathsIngressState::new(
            database.clone(),
            profiles.clone(),
            ingress_credential.clone(),
        );
        let integrations = worktree_integrations::compose(&database, &profiles).await;
        let launch_policy = crate::work_management::launch_policy::LaunchPolicyResolver::new(
            database.clone(),
            profiles.clone(),
        );
        let graph_runs = terminal_launch.clone().map(|terminal_launch| {
            crate::graph_run_service::GraphRunService::production(
                database.clone(),
                launch_policy.clone(),
                terminal_launch,
            )
        });
        let service_state = WorktrackerMcpService::new(
            database.clone(),
            AttachmentStorage::new(configuration.media_root),
            backend,
            launch_policy,
            graph_runs,
            crate::terminal_cleanup::TerminalCleanupService::new(database, cleanup_runtime),
            terminal_launch.clone(),
            integrations,
        );
        let reconciliation_state = service_state.clone();
        let service: StreamableHttpService<WorktrackerMcpService, LocalSessionManager> =
            StreamableHttpService::new(
                move || Ok(service_state.clone()),
                Default::default(),
                StreamableHttpServerConfig::default()
                    .with_legacy_session_mode(false)
                    .with_json_response(true)
                    .with_sse_keep_alive(None)
                    .with_cancellation_token(cancellation.child_token()),
            );
        // The lifecycle ingress shares this loopback listener rather than
        // opening a second one. It is not an MCP tool: it is the seam the
        // Python hook adapter forwards a normalized fact through, so the
        // durable write happens before its caller is acknowledged.
        let mut router = Router::new()
            .nest_service("/mcp", service)
            .route(
                "/runs/lifecycle",
                axum::routing::post(runs_lifecycle::ingest),
            )
            .with_state(runs_lifecycle::RunsIngressState::new(
                ingress_database,
                ingress_backend_base_url,
                ingress_credential.clone(),
            ))
            // The launch-path boundary carries its own state, so it is merged
            // rather than folded into the Runs ingress: nothing it can reach
            // is a Runs write, and nothing the Runs ingress holds is a path.
            .merge(
                Router::new()
                    .route(
                        "/workspace/launch-paths",
                        axum::routing::post(launch_paths::resolve),
                    )
                    .with_state(launch_paths_state),
            );
        if let Some(terminal_launch) = terminal_launch {
            router = router.merge(
                Router::new()
                    .route(
                        "/terminal/launch",
                        axum::routing::post(terminal_launch_ingress::launch),
                    )
                    .with_state(terminal_launch_ingress::TerminalLaunchIngressState::new(
                        terminal_launch,
                        ingress_credential,
                    )),
            );
        }
        let reconciliation_shutdown = cancellation.clone();
        let reconciler = tokio::spawn(async move {
            loop {
                reconciliation_state.reconcile_worktree_integrations().await;
                tokio::select! {
                    _ = reconciliation_shutdown.cancelled() => break,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {}
                }
            }
        });
        let shutdown = cancellation.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
                .await
            {
                eprintln!("Ticketry WorkTracker MCP listener stopped unexpectedly: {error}");
            }
        });
        let runtime = Self {
            address,
            cancellation,
            task,
            reconciler,
        };
        if let Err(error) = verify_tool_list(address).await {
            runtime.shutdown().await;
            return Err(error);
        }
        Ok(runtime)
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    pub async fn shutdown(mut self) {
        self.cancellation.cancel();
        let _ = (&mut self.task).await;
        let _ = (&mut self.reconciler).await;
    }
}

async fn verify_tool_list(address: SocketAddr) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(format!("http://{address}/mcp"))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2025-03-26")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "ticketry-readiness",
            "method": "tools/list",
            "params": {}
        }))
        .send()
        .await
        .map_err(|error| format!("could not probe WorkTracker MCP listener: {error}"))?;
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("could not decode WorkTracker MCP tool list: {error}"))?;
    let count = body["result"]["tools"]
        .as_array()
        .map(Vec::len)
        .unwrap_or_default();
    if count != registry::tools().len() {
        return Err(format!(
            "WorkTracker MCP readiness listed {count} tools; expected {}.",
            registry::tools().len()
        ));
    }
    Ok(())
}

impl Drop for McpRuntime {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.task.abort();
        self.reconciler.abort();
    }
}

pub fn loopback(port: u16) -> Result<SocketAddr, io::Error> {
    format!("127.0.0.1:{port}")
        .parse()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

#[cfg(test)]
mod acceptance_tests;
#[cfg(test)]
mod tests;
