//! The desktop-runtime execution harness: the highest seam slice 6 is proved at.
//!
//! Composition is the product's own. The desktop's Rust first-launch path
//! provisions a temporary SQLite database, then deterministic campaign facts
//! are inserted before the runtimes start. The same entry point installs Work
//! Management, launch policy, Runs, Terminal,
//! status, and the GraphQL endpoint. The in-process MCP listener is started over
//! that composition, and the execution reconciliation runtime is started after
//! Terminal recovery is ready, exactly as startup orders them. Launches use the
//! product's own interactive Terminal runtime, so a launch creates a verified
//! tmux runtime and recovery adopts it.
//!
//! Three things are disposable rather than simulated. The tmux server is
//! private to the harness, so the runtime a test creates, kills, and adopts is
//! never a developer's own. The approved provider is a disposable executable,
//! so no real coding agent runs. And `execution_authorization` records a
//! disposable caller Agent Run and asks the in-process Rust authority for its
//! real MCP grant. Crash points are injected at the composed launch pipeline's
//! own boundaries; nothing else about the effect is faked.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, MutexGuard};
use std::time::Duration;

use muxed_studio_lib::execution::reconciliation::{
    ExecutionReconciliationConfig, ExecutionReconciliationRuntime, ExecutionReconciliationService,
};
use muxed_studio_lib::graphql_foundation::{
    adopt_worktracker_and_install, ComposedCommandRuntime, InstallationOwnership,
};
use muxed_studio_lib::mcp::{McpConfiguration, McpRuntime};
use muxed_studio_lib::terminal::launch::{TerminalLaunchBoundary, TerminalLaunchService};
use muxed_studio_lib::terminal::lifecycle::{
    ProductionTerminalLifecycleWork, TerminalLifecycleConfig, TerminalLifecycleRuntime,
    TerminalRuntimeAuthority,
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use serde_json::{json, Value};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_runs::persistence::{publish_readiness, Slice3Readiness};
use ticketry_work_management::work_management::launch_policy::LaunchPolicyResolver;

use super::execution_authorization::{Authorization, AUTHORIZATION_CREDENTIAL};
use super::execution_fixture as fixture;
use super::execution_legacy_fixture as legacy_fixture;
use super::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, TMUX_ENV_LOCK};

/// How a test wants the composed runtime built.
pub struct HarnessOptions {
    /// Zero leaves the periodic backstop pass off, so advancement is only what
    /// a request, an event, or startup did. A non-zero interval proves the
    /// backstop itself.
    pub pass_interval: Duration,
    /// Stop the first launch that reaches this boundary, once. The stop is not
    /// re-armed by a restart, so recovery is observed converging. It applies to
    /// the launch pipeline the MCP listener and reconciliation share.
    pub stop_once_at: Option<TerminalLaunchBoundary>,
}

impl Default for HarnessOptions {
    fn default() -> Self {
        Self {
            pass_interval: Duration::ZERO,
            stop_once_at: None,
        }
    }
}

pub struct ExecutionHarness {
    _environment_lock: MutexGuard<'static, ()>,
    _environment: TmuxEnvironmentOverride,
    directory: tempfile::TempDir,
    pub tmux: IsolatedTmux,
    authorization: Authorization,
    options: HarnessOptions,
    api: TransportApiImpl,
    composed: Option<ComposedCommandRuntime>,
    launch: Option<TerminalLaunchService>,
    terminal: Option<Arc<TerminalLifecycleRuntime>>,
    execution: Option<ExecutionReconciliationRuntime>,
    mcp: Option<McpRuntime>,
    mcp_url: String,
}

impl ExecutionHarness {
    /// Provision, adopt, and compose a campaign installation that has never
    /// armed a campaign.
    pub async fn start() -> Self {
        Self::start_with_options(HarnessOptions::default()).await
    }

    pub async fn start_with_options(options: HarnessOptions) -> Self {
        Self::start_prepared(options, true).await
    }

    /// Compose over the checked historical current-leaf fixture, so adoption of
    /// copied data is observed separately from a fresh Rust installation.
    pub async fn start_over_legacy_current(options: HarnessOptions) -> Self {
        Self::start_prepared(options, false).await
    }

    async fn start_prepared(options: HarnessOptions, fresh_campaign: bool) -> Self {
        let environment_lock = TMUX_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().expect("create execution harness directory");
        if !fresh_campaign {
            legacy_fixture::provision_current(directory.path()).await;
        }
        approve_module_link(directory.path());
        let tmux = IsolatedTmux::start_empty();
        let environment =
            TmuxEnvironmentOverride::set_with_data_directory(&tmux.socket_dir, directory.path());
        approve_disposable_provider(directory.path());
        let authorization = Authorization::default();
        if !fresh_campaign {
            authorization.bind_to_project(legacy_fixture::PROJECT, legacy_fixture::PARALLEL_ROOT);
        }
        let mut harness = Self {
            _environment_lock: environment_lock,
            _environment: environment,
            directory,
            tmux,
            authorization,
            options,
            api: TransportApiImpl::new(),
            composed: None,
            launch: None,
            terminal: None,
            execution: None,
            mcp: None,
            mcp_url: String::new(),
        };
        harness.compose(fresh_campaign).await;
        harness
    }

    /// Try to compose, so an adoption refusal is observable as a refusal rather
    /// than a panic. Nothing downstream of adoption is started on failure.
    ///
    /// The environment lock is deliberately held across the adoption await: it
    /// guards process-wide tmux and data-directory variables, so releasing it
    /// early would let a concurrent harness repoint them mid-adoption.
    #[allow(clippy::await_holding_lock)]
    pub async fn try_adopt_legacy_current(mutation: &str) -> Result<(), String> {
        let _lock = TMUX_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().expect("create execution adoption directory");
        legacy_fixture::provision_current(directory.path()).await;
        legacy_fixture::mutate(directory.path(), mutation).await;
        let api = TransportApiImpl::new();
        adopt_worktracker_and_install(
            &directory.path().join("rust-core.sqlite3"),
            directory.path(),
            &api,
            InstallationOwnership::Owned,
        )
        .await
        .map(|_| ())
        .map_err(|error| error.message)
    }

    /// Stop the running services the way normal shutdown does, then compose
    /// them again over the same database, data directory, and tmux server.
    pub async fn restart(&mut self) {
        self.stop().await;
        self.options.stop_once_at = None;
        self.api = TransportApiImpl::new();
        self.compose(false).await;
    }

    /// Normal shutdown: stop accepting mutations and cancel future passes,
    /// leaving every durable row and live runtime in place.
    pub async fn shutdown(&mut self) {
        self.stop().await;
    }

    async fn stop(&mut self) {
        if let Some(execution) = self.execution.take() {
            execution.shutdown().await;
        }
        if let Some(terminal) = self.terminal.take() {
            let _ = terminal.shutdown().await;
        }
        if let Some(mcp) = self.mcp.take() {
            mcp.shutdown().await;
        }
        if let Some(composed) = &self.composed {
            self.authorization.stop(composed.commands()).await;
        }
        self.launch.take();
        self.composed.take();
    }

    async fn compose(&mut self, seed_fresh_campaign: bool) {
        let data_directory = self.directory.path().to_owned();
        let adopted = adopt_worktracker_and_install(
            &data_directory.join("rust-core.sqlite3"),
            &data_directory,
            &self.api,
            InstallationOwnership::Owned,
        )
        .await
        .expect("adopt and compose the execution harness");
        // Startup opens each slice gate in order. Graph Run mutations travel
        // over the same authored GraphQL endpoint, so the Slice 2 command gate
        // has to be open before any of them is reachable.
        ticketry_settings::publish_readiness(
            &data_directory,
            &ticketry_settings::Slice2Readiness::complete(),
        )
        .expect("open the local settings gate");
        publish_readiness(&data_directory, &Slice3Readiness::complete())
            .expect("open the Runs GraphQL gate");
        muxed_studio_lib::workspace::handoff::publish_readiness(
            &data_directory,
            &muxed_studio_lib::workspace::handoff::Slice4Readiness::complete(),
        )
        .expect("open the workspace gate");
        let composed = adopted.runtime;
        let commands = composed.commands().clone();
        if seed_fresh_campaign {
            fixture::seed_campaign(&commands).await;
        }
        // A module's local folder is its typed link, so it is recorded once the
        // Modules themselves exist rather than written into a profile file.
        link_modules(&commands, &data_directory).await;
        let spool_directory =
            ticketry_runs::hook_spool::ensure_hook_spool_directory(&data_directory)
                .expect("create the provider hook spool directory");

        // The interactive runtime is shared with the GraphQL composition, so
        // every transport prepares and adopts the same verified runtime.
        let launch_runtime = Arc::new(composed.terminal_runtime().clone());
        let mut launch = TerminalLaunchService::new(commands.clone(), launch_runtime.clone())
            .with_authority(Arc::new(
                muxed_studio_lib::launch::authority::LaunchAuthorityService::new(commands.clone()),
            ));
        if let Some(boundary) = self.options.stop_once_at {
            launch = launch.stopping_once_at(boundary);
        }

        let mcp = McpRuntime::start_with_terminal_launch(
            McpConfiguration {
                address: muxed_studio_lib::mcp::loopback(0).expect("loopback address"),
                database_path: data_directory.join("state.db"),
                media_root: data_directory.join("media"),
                ingress_credential: AUTHORIZATION_CREDENTIAL.to_owned(),
            },
            launch.clone(),
        )
        .await
        .expect("start the in-process MCP listener");
        let run_authority = mcp.authority();
        self.authorization.start(&commands, &run_authority).await;
        self.mcp_url = format!("http://{}/mcp", mcp.address());

        // Startup is what points the interactive runtime at the launch paths,
        // hook spool, and run authorization it needs.
        composed
            .terminal_runtime()
            .configure(TerminalRuntimeAuthority {
                database: commands.clone(),
                paths: muxed_studio_lib::launch::paths::LaunchPathsService::new(commands.clone()),
                hook_runner: provider_directory(&data_directory).join("ticketry-hook-runner"),
                hook_spool_directory: spool_directory.clone(),
                mcp_url: format!("http://{}/mcp", mcp.address()),
                run_authority: mcp.authority(),
                granted_operations: muxed_studio_lib::mcp::allowed_provider_operations(),
            });

        let spool = ticketry_runs::hook_spool::HookSpool::new(
            spool_directory,
            ticketry_runs::persistence::RunsServices::new(commands.clone())
                .lifecycle()
                .clone(),
            ticketry_runs::hook_spool::DEFAULT_BATCH_SIZE,
        )
        .expect("open the provider hook spool");
        let reconciliation =
            muxed_studio_lib::terminal::reconciliation::TerminalReconciliationService::new(
                commands.clone(),
                launch_runtime,
                Arc::new(muxed_studio_lib::terminal::cleanup::TmuxCleanupRuntime),
            );
        let terminal = Arc::new(
            TerminalLifecycleRuntime::start(
                Arc::new(ProductionTerminalLifecycleWork::new(
                    commands.clone(),
                    spool,
                    reconciliation,
                    composed.viewer_ownership().clone(),
                )),
                TerminalLifecycleConfig {
                    sweep_interval: Duration::ZERO,
                    ..TerminalLifecycleConfig::default()
                },
            )
            .await
            .expect("start terminal recovery"),
        );

        let execution = ExecutionReconciliationRuntime::start(
            ExecutionReconciliationService::new(
                commands.clone(),
                LaunchPolicyResolver::new(commands),
                launch.clone(),
            ),
            Arc::clone(&terminal),
            ExecutionReconciliationConfig {
                pass_interval: self.options.pass_interval,
                ..ExecutionReconciliationConfig::default()
            },
        )
        .await
        .expect("start execution reconciliation");

        self.composed = Some(composed);
        self.launch = Some(launch);
        self.terminal = Some(terminal);
        self.execution = Some(execution);
        self.mcp = Some(mcp);
    }

    pub fn data_directory(&self) -> &Path {
        self.directory.path()
    }

    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }

    /// The composed pool authored commands write through.
    pub fn commands(&self) -> &DatabaseConnection {
        self.composed
            .as_ref()
            .expect("composed runtime is running")
            .commands()
    }

    /// A reconciliation service over the composed pieces, for the event and
    /// batch entry points a wake-up would use.
    pub fn reconciliation(&self) -> ExecutionReconciliationService {
        let composed = self.composed.as_ref().expect("composed runtime is running");
        let commands = composed.commands().clone();
        ExecutionReconciliationService::new(
            commands.clone(),
            LaunchPolicyResolver::new(commands),
            self.launch
                .as_ref()
                .expect("launch service is composed")
                .clone(),
        )
    }

    /// Ask Terminal recovery for one bounded pass, the way a lifecycle fact or
    /// a liveness-refresh request does. Only the durable Terminal outcome it
    /// records can clear liveness.
    pub async fn sweep_terminals(&self) {
        self.terminal
            .as_ref()
            .expect("terminal recovery is running")
            .request_sweep()
            .await;
    }

    /// End one verified runtime the way a finished agent does, then let Terminal
    /// recovery record the durable outcome.
    pub async fn end_runtime(&self, agent_run_id: &str) {
        self.tmux.kill_agent_run(agent_run_id);
        self.sweep_terminals().await;
    }

    /// Age every launch lease the way a real interval between opens does, so
    /// recovery may take over an effect the interrupted process still held.
    pub async fn expire_launch_leases(&self) {
        self.database()
            .await
            .execute_unprepared(
                "UPDATE runs_launch_effects SET lease_expires_at='2000-01-01 00:00:00' \
                 WHERE state='leased'",
            )
            .await
            .expect("age the launch leases");
    }

    /// Every verified runtime the private tmux server currently hosts, by the
    /// Agent Run identity it was created under.
    pub fn live_runtimes(&self) -> Vec<String> {
        let mut identities = self
            .tmux
            .inventory()
            .into_iter()
            .map(|(name, _)| name)
            .collect::<Vec<_>>();
        identities.sort();
        identities
    }

    /// Move a Work Item through the composed command, so the transition
    /// occurrence execution consumes is the one Work Management committed.
    pub async fn set_state(&self, task_id: &str, state_name: &str) -> Value {
        self.mcp(
            "update_task_status",
            json!({
                "project_id": fixture::CAMPAIGN_PROJECT,
                "task_id": task_id,
                "status_name": state_name,
            }),
        )
        .await
    }

    /// Press a campaign the way an MCP caller does. An omitted mode keeps the
    /// established parallel default.
    pub async fn execute(&self, root_id: &str) -> Value {
        self.mcp("execute_dependency_graph", json!({"root_task_id": root_id}))
            .await
    }

    pub async fn graphql(&self, query: &str, variables: Value) -> Value {
        let request = json!({"query": query, "variables": variables}).to_string();
        serde_json::from_str(&self.api.clone().graphql_execute(request).await)
            .expect("decode execution GraphQL response")
    }

    /// Call one MCP tool over the listener's own HTTP transport, so the tool
    /// registry, authorization, and dispatch are all real.
    pub async fn mcp(&self, name: &str, arguments: Value) -> Value {
        self.authorization.refresh_binding(self.commands()).await;
        let credential = self.authorization.credential();
        let response = reqwest::Client::new()
            .post(&self.mcp_url)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2025-03-26")
            .header("authorization", credential)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": "slice6",
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }))
            .send()
            .await
            .expect("call the MCP listener")
            .json::<Value>()
            .await
            .expect("decode the MCP response");
        response["result"]["structuredContent"].clone()
    }

    /// A second read-write pool, for the durable facts a test inspects without
    /// competing for the composed pool's write lock.
    pub async fn database(&self) -> DatabaseConnection {
        Database::connect(format!(
            "sqlite:{}?mode=rw",
            self.directory.path().join("state.db").display()
        ))
        .await
        .expect("open the execution harness database")
    }
}

fn provider_directory(data_directory: &Path) -> PathBuf {
    data_directory.join("approved-bin")
}

/// Approve a disposable provider executable, so an interactive launch has a
/// real approved command to run inside the private tmux server without any
/// developer tool being invoked.
fn approve_disposable_provider(data_directory: &Path) {
    let bin = provider_directory(data_directory);
    std::fs::create_dir_all(&bin).expect("create the disposable executable directory");
    let hook_runner = bin.join("ticketry-hook-runner");
    std::fs::write(&hook_runner, b"#!/bin/sh\nexit 0\n").expect("write the disposable hook runner");
    let executable = bin.join("codex");
    std::fs::write(
        &executable,
        b"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex 903.0.0\\n'; exit 0; fi\nwhile :; do sleep 1; done\n",
    )
    .expect("write the disposable provider");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&hook_runner, &executable] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
                .expect("make the disposable executable runnable");
        }
    }
    let approved = ticketry_tool_discovery::approve_executable_path(
        ticketry_tool_discovery::SupportedTool::Codex,
        executable,
    )
    .expect("approve the disposable provider through the product boundary");
    assert_eq!(approved.health, ticketry_tool_discovery::ToolHealth::Ready);
}

/// The selected profile a launch decision needs. Module folders are no longer
/// part of it: those are each Module's own typed link.
fn approve_module_link(data_directory: &Path) {
    let profiles = json!({
        "recent_profile_index": 0,
        "profiles": [{
            "name": "Local",
            "workspace_slug": "slice6-execution",
        }],
    });
    std::fs::write(
        data_directory.join("profiles.json"),
        serde_json::to_string(&profiles).expect("profiles fixture is serializable"),
    )
    .expect("write the profile fixture");
}

/// Link every fixture Module to the data directory, so launch-path resolution
/// has a real usable folder to resolve. A Module that is not seeded in this
/// campaign simply has no link, which is ordinary data.
async fn link_modules(commands: &sea_orm::DatabaseConnection, data_directory: &Path) {
    let store = ticketry_work_management::module_links::ModuleLinkStore::new(commands.clone());
    let folder = data_directory.display().to_string();
    for module in [fixture::CAMPAIGN_MODULE, fixture::FOREIGN_MODULE] {
        let _ = store.set(module, &folder).await;
    }
}

/// Selected profiles and durable rows store compact identities.
pub fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

/// Public results carry hyphenated identities, while tool arguments and stored
/// rows carry compact ones. Fixtures name the stored form and convert here.
pub fn public_id(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.hyphenated().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
