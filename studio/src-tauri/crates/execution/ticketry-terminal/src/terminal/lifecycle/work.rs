use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};

use crate::terminal::launch::{
    TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalRuntimeObservation,
    VerifiedTerminalRuntime,
};
use crate::terminal::reconciliation::{
    RecordedSessionDecision, TerminalReconciliationReport, TerminalReconciliationService,
};
use crate::tmux_adapter::{
    ApprovedArgv, CreateOutcome, CreateSession, PersistedSessionName, RuntimeIdentity,
    RuntimeObservation, TerminalGeometry, TmuxAdapter,
};
use crate::viewer_ownership::ViewerOwnershipService;
use ticketry_diagnostics as trace;
use ticketry_launch::{TerminalLaunchError, TerminalLaunchErrorCode};
use ticketry_runs::{DrainReport, HookSpool, LifecycleService, RunAuthority};

#[async_trait]
pub trait TerminalLifecycleWork: Send + Sync + 'static {
    async fn verify_schema(&self) -> Result<(), String>;
    async fn drain_spool(&self) -> Result<DrainReport, String>;
    async fn reconcile(&self) -> Result<TerminalReconciliationReport, String>;
    /// Retire every lease. Reserved for the gated startup and shutdown passes.
    async fn expire_viewer_leases(&self) -> Result<u64, String>;
    /// Retire only lapsed leases, so periodic passes leave renewed viewers
    /// holding their ownership.
    async fn expire_stale_viewer_leases(&self) -> Result<u64, String>;
}

/// The existing terminal services composed over the schema's one writable pool.
pub struct ProductionTerminalLifecycleWork {
    database: DatabaseConnection,
    spool: HookSpool<LifecycleService>,
    reconciliation: TerminalReconciliationService,
    viewers: ViewerOwnershipService,
}

impl ProductionTerminalLifecycleWork {
    pub fn new(
        database: DatabaseConnection,
        spool: HookSpool<LifecycleService>,
        reconciliation: TerminalReconciliationService,
        viewers: ViewerOwnershipService,
    ) -> Self {
        Self {
            database,
            spool,
            reconciliation,
            viewers,
        }
    }
}

#[async_trait]
impl TerminalLifecycleWork for ProductionTerminalLifecycleWork {
    async fn verify_schema(&self) -> Result<(), String> {
        crate::terminal::persistence::terminals_adopted(&self.database)
            .await
            .then_some(())
            .ok_or_else(|| "the Terminal schema has not completed adoption".to_owned())
    }

    async fn drain_spool(&self) -> Result<DrainReport, String> {
        self.spool
            .drain_required()
            .await
            .map_err(|error| error.to_string())
    }

    async fn reconcile(&self) -> Result<TerminalReconciliationReport, String> {
        let report = self
            .reconciliation
            .reconcile()
            .await
            .map_err(|error| error.to_string())?;
        let unavailable_session = report
            .sessions
            .iter()
            .any(|item| item.decision == RecordedSessionDecision::Unavailable);
        if report.inventory_unavailable || unavailable_session {
            let detail = match TmuxAdapter::discover() {
                Ok(adapter) => adapter
                    .classified_inventory()
                    .map(|_| "the follow-up inventory succeeded".to_owned())
                    .unwrap_or_else(|error| error.to_string()),
                Err(error) => error.to_string(),
            };
            return Err(format!(
                "verified terminal runtime observation is unavailable: {detail}"
            ));
        }
        Ok(report)
    }

    async fn expire_viewer_leases(&self) -> Result<u64, String> {
        self.viewers
            .expire_all()
            .await
            .map_err(|error| error.to_string())
    }

    async fn expire_stale_viewer_leases(&self) -> Result<u64, String> {
        self.viewers
            .expire_stale()
            .await
            .map_err(|error| error.to_string())
    }
}

/// Recovery can inspect and adopt existing runtimes before the interactive
/// launch materializer is composed. If a prepared effect needs a fresh process,
/// startup stays unavailable instead of calling the Python launcher.
#[derive(Clone, Default)]
pub struct RecoveryTerminalLaunchRuntime;

#[async_trait]
impl TerminalLaunchRuntime for RecoveryTerminalLaunchRuntime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        let adapter = match TmuxAdapter::discover() {
            Ok(adapter) => adapter,
            Err(_) => return TerminalRuntimeObservation::Unavailable,
        };
        let namespace = match crate::tmux_adapter::current_runtime_namespace() {
            Ok(namespace) => namespace,
            Err(_) => return TerminalRuntimeObservation::Unavailable,
        };
        let identity = match RuntimeIdentity::new(agent_run_id, &namespace) {
            Ok(identity) => identity,
            Err(_) => return TerminalRuntimeObservation::Ambiguous,
        };
        match adapter.observe(&identity) {
            RuntimeObservation::Running => {
                TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                    tmux_session_name: PersistedSessionName::for_identity(&identity).into_string(),
                    runtime_namespace: namespace,
                })
            }
            RuntimeObservation::Exited { exit_code } => {
                TerminalRuntimeObservation::Exited { exit_code }
            }
            RuntimeObservation::Missing => TerminalRuntimeObservation::Missing,
            RuntimeObservation::Foreign => TerminalRuntimeObservation::Foreign,
            RuntimeObservation::Ambiguous => TerminalRuntimeObservation::Ambiguous,
            RuntimeObservation::Unavailable { .. } => TerminalRuntimeObservation::Unavailable,
        }
    }

    async fn materialize_and_create(
        &self,
        _material: &ticketry_entities::launch_material::Model,
        _checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::RuntimeUnavailable,
            "Terminal launch recovery cannot create a runtime before the Rust launch authority is composed.",
        ))
    }
}

#[derive(Clone)]
pub struct TerminalRuntimeAuthority {
    pub database: DatabaseConnection,
    pub paths: ticketry_launch::LaunchPathsService,
    pub hook_runner: PathBuf,
    pub hook_spool_directory: PathBuf,
    pub mcp_url: String,
    pub run_authority: RunAuthority,
    /// The operations a launched run's grant may name. The composer supplies
    /// them, so terminal never reads the MCP tool registry above it.
    pub granted_operations: Vec<String>,
}

/// Interactive launches materialize approved provider argv in Rust and create
/// the verified tmux runtime directly.
#[derive(Clone)]
pub struct InteractiveTerminalLaunchRuntime {
    authority: Arc<std::sync::RwLock<Option<TerminalRuntimeAuthority>>>,
}

impl InteractiveTerminalLaunchRuntime {
    pub fn new() -> Self {
        Self {
            authority: Arc::new(std::sync::RwLock::new(None)),
        }
    }

    pub fn configure(&self, authority: TerminalRuntimeAuthority) {
        *self
            .authority
            .write()
            .expect("terminal authority lock poisoned") = Some(authority);
    }

    pub fn clear_authority(&self) {
        if let Some(authority) = self
            .authority
            .write()
            .expect("terminal authority lock poisoned")
            .as_mut()
        {
            authority.mcp_url.clear();
        }
    }

    pub fn replace_mcp_authority(
        &self,
        mcp_url: String,
        run_authority: RunAuthority,
    ) -> Result<(), String> {
        let mut authority = self
            .authority
            .write()
            .expect("terminal authority lock poisoned");
        let current = authority
            .as_mut()
            .ok_or_else(|| "the terminal launch authority is unavailable".to_owned())?;
        current.mcp_url = mcp_url;
        current.run_authority = run_authority;
        Ok(())
    }
}

impl Default for InteractiveTerminalLaunchRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TerminalLaunchRuntime for InteractiveTerminalLaunchRuntime {
    async fn preflight(
        &self,
        request: &ticketry_launch::CreateTerminalSession,
    ) -> Result<(), TerminalLaunchError> {
        let authority = self
            .authority
            .read()
            .expect("terminal authority lock poisoned")
            .clone()
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::RuntimeUnavailable,
                    "The Rust terminal launch authority is not ready.",
                )
            })?;
        require_provider_control(request.kind, &authority.mcp_url)?;
        authority
            .paths
            .preflight_module_folder(&request.module_id)
            .await
            .map(drop)
            .map_err(|refusal| {
                TerminalLaunchError::new(TerminalLaunchErrorCode::UnusableFolder, refusal.message())
            })
    }

    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        RecoveryTerminalLaunchRuntime.observe(agent_run_id).await
    }

    async fn materialize_and_create(
        &self,
        material: &ticketry_entities::launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        let authority = self
            .authority
            .read()
            .expect("terminal authority lock poisoned")
            .clone()
            .ok_or_else(|| {
                TerminalLaunchError::new(
                    TerminalLaunchErrorCode::RuntimeUnavailable,
                    "The Rust terminal launch authority is not ready.",
                )
            })?;
        if material.scope == "shell" {
            if material.provider.is_some()
                || material.model.is_some()
                || material.reasoning.is_some()
                || material.prompt.is_some()
                || material.resume_from_agent_run_id.is_some()
                || material.design_directory_identity.is_some()
                || material.doc_rel_path.is_some()
                || material.required_skills != serde_json::json!([])
            {
                return Err(invalid_launch(
                    "Stored shell launch material contains agent metadata.",
                ));
            }
            let working_directory = match authority
                .paths
                .preflight_module_folder(&material.module_id)
                .await
            {
                Ok(directory) => {
                    trace::admitted(trace::DIRECTORY_PREFLIGHTED)
                        .with("launchForm", "shell")
                        .record();
                    directory
                }
                Err(refusal) => {
                    trace::refused(trace::DIRECTORY_PREFLIGHTED, "module_folder_unusable")
                        .with("launchForm", "shell")
                        .record();
                    return Err(TerminalLaunchError::new(
                        TerminalLaunchErrorCode::UnusableFolder,
                        refusal.message(),
                    ));
                }
            };
            let command = crate::terminal::launch::approved_login_shell(working_directory)?;
            return create_tmux_runtime(material, checkpoint, command).await;
        }
        let provider =
            ticketry_launch::Provider::try_from(material.provider.as_deref().unwrap_or_default())
                .map_err(planning_error)?;
        let scope = match material.scope.as_str() {
            "task" => ticketry_launch::LaunchScope::Task,
            "plan" => ticketry_launch::LaunchScope::Plan,
            "instant" => ticketry_launch::LaunchScope::Instant,
            "docchat" => ticketry_launch::LaunchScope::Docchat,
            _ => return Err(invalid_launch("The terminal launch scope is unsupported.")),
        };
        let paths = authority
            .paths
            .resolve(ticketry_launch::LaunchPathsRequest {
                version: 1,
                scope,
                agent_run_id: material.agent_run_id.clone(),
                project_id: material.project_id.clone(),
                module_id: Some(material.module_id.clone()),
                task_id: matches!(scope, ticketry_launch::LaunchScope::Task)
                    .then(|| material.issue_id.clone()),
                document_id: matches!(scope, ticketry_launch::LaunchScope::Docchat)
                    .then(|| material.task_id.clone()),
            })
            .await
            .map_err(|_| invalid_launch("The terminal launch directory is unavailable."))?;
        let working_directory = paths
            .working_directory
            .map(PathBuf::from)
            .ok_or_else(|| invalid_launch("No local folder is configured for this launch."))?;
        if let Err(refusal) = authority
            .paths
            .preflight_module_folder(&material.module_id)
            .await
        {
            trace::refused(trace::DIRECTORY_PREFLIGHTED, "module_folder_unusable")
                .with("launchForm", "agent")
                .record();
            return Err(TerminalLaunchError::new(
                TerminalLaunchErrorCode::UnusableFolder,
                refusal.message(),
            ));
        }
        trace::admitted(trace::DIRECTORY_PREFLIGHTED)
            .with("launchForm", "agent")
            .record();
        let resume = if let Some(source_id) = material.resume_from_agent_run_id.as_deref() {
            let source = ticketry_entities::agent_run::Entity::find_by_id(source_id)
                .one(&authority.database)
                .await
                .map_err(|_| invalid_launch("The resume source is unavailable."))?
                .ok_or_else(|| invalid_launch("The resume source is unavailable."))?;
            let provider_session_id = source.provider_session_id.ok_or_else(|| {
                invalid_launch("The resume source has no provider conversation identity.")
            })?;
            Some(ticketry_launch::LaunchKind::Resume {
                provider_session_id,
            })
        } else {
            None
        };
        let kind = resume.unwrap_or(match material.scope.as_str() {
            "task" => ticketry_launch::LaunchKind::Task,
            "plan" => ticketry_launch::LaunchKind::Planning,
            "instant" => ticketry_launch::LaunchKind::Instant,
            "docchat" => ticketry_launch::LaunchKind::DocumentChat,
            _ => ticketry_launch::LaunchKind::Automation,
        });
        let workspace = match material.scope.as_str() {
            "plan" | "instant" => ticketry_launch::WorkspaceIdentity::Scratch {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                agent_run_id: material.agent_run_id.clone(),
            },
            "docchat" => ticketry_launch::WorkspaceIdentity::Document {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                document_id: material.design_directory_identity.clone().ok_or_else(|| {
                    invalid_launch("The document launch identity is unavailable.")
                })?,
            },
            _ => ticketry_launch::WorkspaceIdentity::Task {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                task_id: material.task_id.clone(),
            },
        };
        let durable = ticketry_launch::DurableLaunchMaterial::new(
            material.agent_run_id.clone(),
            kind,
            provider,
            ticketry_launch::ProviderOptions {
                model: material.model.clone(),
                reasoning: material.reasoning.clone(),
            },
            material.prompt.clone(),
            serde_json::from_value(material.required_skills.clone())
                .map_err(|_| invalid_launch("The terminal launch skill selection is invalid."))?,
            workspace,
            material.design_directory_identity.clone(),
        );
        let authorization = issue_run_authorization(&authority, &material.agent_run_id).await?;
        let tool = provider_tool(provider);
        let executable = crate::tmux_adapter::approved_tool_path(tool)
            .map_err(|_| invalid_launch("The approved provider executable is unavailable."))?;
        let execution = ticketry_launch::ExecutionAuthority::new(
            executable,
            working_directory,
            authority.hook_runner.clone(),
            authority.hook_spool_directory.clone(),
            authority.mcp_url.clone(),
            authorization,
            available_skills(),
        );
        let mut launch =
            ticketry_launch::materialize(&durable, &execution).map_err(planning_error)?;
        if let Some(settings) = launch.settings.take() {
            let path = authority
                .hook_spool_directory
                .join(format!("settings-{}.json", material.agent_run_id));
            write_private(
                &path,
                &serde_json::to_vec(&settings.contents).unwrap_or_default(),
            )?;
            launch.environment.insert(
                settings.environment_name.to_owned(),
                path.to_string_lossy().into_owned(),
            );
        }
        let command = ApprovedArgv::for_tool(
            tool,
            launch.argv.into_iter().skip(1),
            launch.working_directory,
            launch.environment,
        )
        .map_err(|_| invalid_launch("The provider command is unavailable."))?;
        let spawned = create_tmux_runtime(material, checkpoint, command).await;
        record_prompt_delivery(material.prompt.as_deref(), &spawned);
        spawned
    }
}

fn require_provider_control(
    kind: ticketry_launch::TerminalLaunchKind,
    mcp_url: &str,
) -> Result<(), TerminalLaunchError> {
    if kind != ticketry_launch::TerminalLaunchKind::Shell && mcp_url.is_empty() {
        return Err(TerminalLaunchError::new(
            TerminalLaunchErrorCode::RuntimeUnavailable,
            "WorkTracker MCP is unavailable. Provider launch is blocked.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod provider_control_tests {
    use super::require_provider_control;
    use ticketry_launch::{TerminalLaunchErrorCode, TerminalLaunchKind};

    #[test]
    fn missing_listener_blocks_provider_launch_with_an_empty_url() {
        for kind in [TerminalLaunchKind::Task, TerminalLaunchKind::Planning] {
            let error = require_provider_control(kind, "").expect_err("provider launch blocked");

            assert_eq!(error.code, TerminalLaunchErrorCode::RuntimeUnavailable);
            assert_eq!(
                error.to_string(),
                "WorkTracker MCP is unavailable. Provider launch is blocked."
            );
        }
    }

    #[test]
    fn missing_listener_does_not_block_local_shells() {
        assert!(require_provider_control(TerminalLaunchKind::Shell, "").is_ok());
    }

    #[test]
    fn owned_listener_recovery_allows_provider_launch() {
        assert!(
            require_provider_control(TerminalLaunchKind::Task, "http://127.0.0.1:43219/mcp")
                .is_ok()
        );
    }
}

async fn create_tmux_runtime(
    material: &ticketry_entities::launch_material::Model,
    checkpoint: &dyn TerminalLaunchCheckpoint,
    command: ApprovedArgv,
) -> Result<(), TerminalLaunchError> {
    let outcome = spawn_tmux_runtime(material, checkpoint, command).await;
    if let Err(error) = &outcome {
        trace::refused(trace::RUNTIME_SPAWNED, error.code_str()).record();
    }
    outcome
}

/// A runtime that never came up must be separable from a provider that never
/// started, so the spawn is recorded as its own stage.
async fn spawn_tmux_runtime(
    material: &ticketry_entities::launch_material::Model,
    checkpoint: &dyn TerminalLaunchCheckpoint,
    command: ApprovedArgv,
) -> Result<(), TerminalLaunchError> {
    let adapter = TmuxAdapter::discover().map_err(|_| {
        TerminalLaunchError::new(
            TerminalLaunchErrorCode::RuntimeUnavailable,
            "The tmux runtime is unavailable.",
        )
    })?;
    let identity = RuntimeIdentity::new(
        &material.agent_run_id,
        &crate::tmux_adapter::current_runtime_namespace()
            .map_err(|_| invalid_launch("The terminal runtime namespace is unavailable."))?,
    )
    .map_err(|_| invalid_launch("The terminal runtime identity is invalid."))?;
    match adapter
        .create(&CreateSession {
            identity,
            geometry: TerminalGeometry::new(
                material.initial_columns as u16,
                material.initial_rows as u16,
            )
            .map_err(|_| invalid_launch("The terminal geometry is invalid."))?,
            command,
        })
        .map_err(|error| {
            TerminalLaunchError::new(
                TerminalLaunchErrorCode::RuntimeStartFailed,
                format!("The terminal runtime could not be created: {error}"),
            )
        })? {
        CreateOutcome::Created => {
            trace::admitted(trace::RUNTIME_SPAWNED)
                .with("runtimeOutcome", "created")
                .record();
        }
        CreateOutcome::Existing(RuntimeObservation::Running) => {
            trace::admitted(trace::RUNTIME_SPAWNED)
                .with("runtimeOutcome", "existing_running")
                .record();
        }
        _ => return Err(invalid_launch("The terminal runtime identity conflicts.")),
    }
    checkpoint
        .checkpoint(crate::terminal::launch::TerminalLaunchBoundary::TmuxCreated)
        .await
}

/// Records whether the constructed prompt reached the agent.
///
/// A prompt travels as the last argument of the provider command, so it is
/// delivered exactly when the runtime carrying that command comes up. A run
/// whose terminal opened but whose agent never received a prompt is the case
/// this stage exists to name.
fn record_prompt_delivery(prompt: Option<&str>, spawned: &Result<(), TerminalLaunchError>) {
    let carried = prompt.is_some_and(|prompt| !prompt.trim().is_empty());
    match spawned {
        Ok(()) => trace::admitted(trace::PROMPT_DELIVERED)
            .with("promptCarrier", "argv")
            .with("promptCarried", carried)
            .with("promptCharacters", prompt.map_or(0, str::len))
            .record(),
        Err(error) => trace::refused(trace::PROMPT_DELIVERED, "runtime_never_spawned")
            .with("promptCarrier", "argv")
            .with("promptCarried", carried)
            .with("runtimeRefusal", error.code_str())
            .record(),
    }
}

fn invalid_launch(message: &'static str) -> TerminalLaunchError {
    TerminalLaunchError::new(TerminalLaunchErrorCode::InvalidRequest, message)
}

fn planning_error(error: ticketry_launch::LaunchPlanningError) -> TerminalLaunchError {
    TerminalLaunchError::new(TerminalLaunchErrorCode::InvalidRequest, error.to_string())
}

fn write_private(path: &Path, contents: &[u8]) -> Result<(), TerminalLaunchError> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| invalid_launch("Provider settings could not be prepared."))?;
    file.write_all(contents)
        .map_err(|_| invalid_launch("Provider settings could not be prepared."))
}

fn provider_tool(provider: ticketry_launch::Provider) -> ticketry_tool_discovery::SupportedTool {
    match provider {
        ticketry_launch::Provider::Claude => ticketry_tool_discovery::SupportedTool::Claude,
        ticketry_launch::Provider::Codex => ticketry_tool_discovery::SupportedTool::Codex,
        ticketry_launch::Provider::Gemini => ticketry_tool_discovery::SupportedTool::Gemini,
        ticketry_launch::Provider::Agy => ticketry_tool_discovery::SupportedTool::Agy,
    }
}

fn available_skills() -> BTreeSet<String> {
    serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../../../resources/launch/skills.lock.json"
    ))
    .ok()
    .and_then(|value| value.get("selected_packages").cloned())
    .and_then(|value| serde_json::from_value(value).ok())
    .unwrap_or_default()
}

async fn issue_run_authorization(
    authority: &TerminalRuntimeAuthority,
    agent_run_id: &str,
) -> Result<String, TerminalLaunchError> {
    authority
        .run_authority
        .issue(agent_run_id, authority.granted_operations.clone())
        .await
        .map_err(|_| invalid_launch("Run authorization was refused."))
}
