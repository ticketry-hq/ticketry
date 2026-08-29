//! In-process WorkTracker MCP transport owned by the desktop runtime.

mod authority;
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
use axum::{
    extract::State,
    http::Request,
    middleware::Next,
    response::{IntoResponse, Response},
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::work_management::{commands::attachments::AttachmentStorage, open_for_commands};

pub use authority::{RunAuthority, RunPrincipal};
pub(crate) use registry::allowed_provider_operations;
use service::WorktrackerMcpService;

#[derive(Clone, Debug)]
pub struct McpConfiguration {
    pub address: SocketAddr,
    pub database_path: PathBuf,
    pub media_root: PathBuf,
    pub ingress_credential: String,
}

pub struct McpRuntime {
    address: SocketAddr,
    cancellation: CancellationToken,
    task: JoinHandle<()>,
    reconciler: JoinHandle<()>,
    authority: RunAuthority,
}

impl McpRuntime {
    pub async fn start(configuration: McpConfiguration) -> Result<Self, String> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(crate::terminal::cleanup::TmuxCleanupRuntime),
            None,
        )
        .await
    }

    pub async fn start_with_terminal_launch(
        configuration: McpConfiguration,
        terminal_launch: crate::terminal::launch::TerminalLaunchService,
    ) -> Result<Self, String> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(crate::terminal::cleanup::TmuxCleanupRuntime),
            Some(terminal_launch),
        )
        .await
    }

    #[cfg(test)]
    pub async fn start_for_test(
        configuration: McpConfiguration,
        cleanup_runtime: std::sync::Arc<dyn crate::terminal::cleanup::TerminalCleanupRuntime>,
    ) -> Result<Self, String> {
        Self::start_with_services(configuration, cleanup_runtime, None).await
    }

    async fn start_with_services(
        configuration: McpConfiguration,
        cleanup_runtime: std::sync::Arc<dyn crate::terminal::cleanup::TerminalCleanupRuntime>,
        terminal_launch: Option<crate::terminal::launch::TerminalLaunchService>,
    ) -> Result<Self, String> {
        if !configuration.address.ip().is_loopback() {
            return Err("WorkTracker MCP must bind to a loopback address.".to_owned());
        }
        let ingress_credential = configuration.ingress_credential.clone();
        let database = open_for_commands(&configuration.database_path)
            .await
            .map_err(|error| format!("could not open WorkTracker commands for MCP: {error}"))?;
        let authority = RunAuthority::new(database.clone());
        let listener = tokio::net::TcpListener::bind(configuration.address)
            .await
            .map_err(|error| format!("could not bind WorkTracker MCP listener: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("could not inspect WorkTracker MCP listener: {error}"))?;
        let cancellation = CancellationToken::new();
        let ingress_database = database.clone();
        let launch_paths_state =
            launch_paths::LaunchPathsIngressState::new(database.clone(), ingress_credential.clone());
        let integrations = worktree_integrations::compose(&database).await;
        let launch_policy =
            crate::work_management::launch_policy::LaunchPolicyResolver::new(database.clone());
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
            authority.clone(),
            launch_policy,
            graph_runs,
            crate::terminal::cleanup::TerminalCleanupService::new(database, cleanup_runtime),
            terminal_launch.clone(),
            integrations,
            configuration
                .database_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .to_path_buf(),
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
        // The global MCP endpoint matches the historical Python contract:
        // normal WorkTracker tools are available to local external clients,
        // while run control still requires a run-bound bearer credential.
        let mcp_router = Router::new().nest_service("/mcp", service);
        let lifecycle_router = Router::new()
            .route(
                "/runs/lifecycle",
                axum::routing::post(runs_lifecycle::ingest),
            )
            .route_layer(axum::middleware::from_fn_with_state(
                authority.clone(),
                authenticate_provider_request,
            ))
            .with_state(runs_lifecycle::RunsIngressState::new(
                ingress_database,
                authority.clone(),
            ));
        let mut router = mcp_router
            .merge(lifecycle_router)
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
            authority,
        };
        verify_registry()?;
        Ok(runtime)
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }

    pub fn authority(&self) -> RunAuthority {
        self.authority.clone()
    }

    #[cfg(test)]
    pub async fn grant_for_test(
        &self,
        agent_run_id: &str,
        token: &str,
        allowed_tools: impl IntoIterator<Item = String>,
        expired: bool,
    ) -> Result<String, authority::AuthorizationFailure> {
        self.authority
            .grant_for_test(agent_run_id, token, allowed_tools, expired)
            .await
    }

    pub async fn shutdown(mut self) {
        self.cancellation.cancel();
        let _ = (&mut self.task).await;
        let _ = (&mut self.reconciler).await;
    }
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

async fn authenticate_provider_request(
    State(authority): State<RunAuthority>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok());
    match authority.authenticate(authorization).await {
        Ok(_) => next.run(request).await,
        Err(failure) => {
            (axum::http::StatusCode::UNAUTHORIZED, axum::Json(failure.0)).into_response()
        }
    }
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
