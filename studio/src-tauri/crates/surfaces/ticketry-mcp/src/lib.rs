#![deny(private_bounds, private_interfaces)]

//! The in-process MCP tool listener: how a coding agent talks to Ticketry.
//!
//! An agent running inside a terminal reaches the product through one
//! loopback MCP endpoint this crate serves. [`McpRuntime`] binds it, and every
//! call arrives carrying a run credential that [`RunAuthority`] — minted where
//! the run itself lives — resolves into a [`RunPrincipal`]: which run is
//! calling, for which work item, and how far its scope reaches.
//!
//! What the listener exposes is composition, not model code. The registry
//! names the tools, dispatch turns one call into work-management commands,
//! graph runs, terminal launches or run termination, and projection renders
//! the answer back as the agent's own vocabulary. Nothing here owns a table;
//! it sits above the slices it dispatches into, which is why the schema is
//! assembled out of this crate rather than underneath it.

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
mod termination_eligibility;
#[cfg(any(test, feature = "test-support"))]
mod test_support;
mod workflow_tools;

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

use ticketry_work_management::{commands::attachments::AttachmentStorage, open_for_commands};

pub use registry::allowed_provider_operations;
use service::WorktrackerMcpService;
pub use ticketry_runs::{RunAuthority, RunPrincipal};

// `test_support` is intentionally not a public module. Its fixture helpers
// are part of the explicit test-support facade so integration consumers can
// opt into them without exposing the MCP implementation tree.
#[cfg(any(test, feature = "test-support"))]
pub use test_support::{post, start_authorizer, PROJECT};

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
    authority: RunAuthority,
}

#[derive(Debug, Eq, PartialEq)]
pub enum McpStartupError {
    AddressInUse { diagnostic: String },
    Other { diagnostic: String },
}

impl McpStartupError {
    fn other(diagnostic: impl Into<String>) -> Self {
        Self::Other {
            diagnostic: diagnostic.into(),
        }
    }

    fn from_bind(error: io::Error) -> Self {
        let diagnostic = format!("could not bind WorkTracker MCP listener: {error}");
        if error.kind() == io::ErrorKind::AddrInUse {
            Self::AddressInUse { diagnostic }
        } else {
            Self::Other { diagnostic }
        }
    }

    pub fn is_address_in_use(&self) -> bool {
        matches!(self, Self::AddressInUse { .. })
    }

    pub fn diagnostic(&self) -> &str {
        match self {
            Self::AddressInUse { diagnostic } | Self::Other { diagnostic } => diagnostic,
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
    pub async fn start(configuration: McpConfiguration) -> Result<Self, McpStartupError> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(ticketry_terminal::TmuxCleanupRuntime),
            None,
        )
        .await
    }

    pub async fn start_with_terminal_launch(
        configuration: McpConfiguration,
        terminal_launch: ticketry_terminal::TerminalLaunchService,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(
            configuration,
            std::sync::Arc::new(ticketry_terminal::TmuxCleanupRuntime),
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
        cleanup_runtime: std::sync::Arc<dyn ticketry_terminal::TerminalCleanupRuntime>,
    ) -> Result<Self, McpStartupError> {
        Self::start_with_services(configuration, cleanup_runtime, None).await
    }

    async fn start_with_services(
        configuration: McpConfiguration,
        cleanup_runtime: std::sync::Arc<dyn ticketry_terminal::TerminalCleanupRuntime>,
        terminal_launch: Option<ticketry_terminal::TerminalLaunchService>,
    ) -> Result<Self, McpStartupError> {
        if !configuration.address.ip().is_loopback() {
            return Err(McpStartupError::other(
                "WorkTracker MCP must bind to a loopback address.",
            ));
        }
        let ingress_credential = configuration.ingress_credential.clone();
        let database = open_for_commands(&configuration.database_path)
            .await
            .map_err(|error| {
                McpStartupError::other(format!(
                    "could not open WorkTracker commands for MCP: {error}"
                ))
            })?;
        let data_directory = configuration
            .database_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .to_path_buf();
        let authority = RunAuthority::persistent(database.clone(), &data_directory)
            .map_err(McpStartupError::other)?;
        let listener = tokio::net::TcpListener::bind(configuration.address)
            .await
            .map_err(McpStartupError::from_bind)?;
        let address = listener.local_addr().map_err(|error| {
            McpStartupError::other(format!(
                "could not inspect WorkTracker MCP listener: {error}"
            ))
        })?;
        let cancellation = CancellationToken::new();
        let ingress_database = database.clone();
        let launch_paths_state = launch_paths::LaunchPathsIngressState::new(
            database.clone(),
            ingress_credential.clone(),
        );
        let launch_policy =
            ticketry_work_management::launch_policy::LaunchPolicyResolver::new(database.clone());
        let graph_runs = terminal_launch.clone().map(|terminal_launch| {
            ticketry_agent_execution::GraphRunService::production(
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
            ticketry_terminal::TerminalCleanupService::new(database, cleanup_runtime),
            terminal_launch.clone(),
            data_directory,
        );
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
            authority,
        };
        verify_registry().map_err(McpStartupError::other)?;
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

    pub async fn shutdown(mut self) {
        self.cancellation.cancel();
        let _ = (&mut self.task).await;
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
    }
}

pub fn loopback(port: u16) -> Result<SocketAddr, io::Error> {
    format!("127.0.0.1:{port}")
        .parse()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

#[cfg(test)]
mod tests;
