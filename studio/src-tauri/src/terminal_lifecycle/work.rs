use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};

use crate::hook_spool::{DrainReport, HookSpool};
use crate::runs_persistence::LifecycleService;
use crate::terminal_launch::{
    TerminalLaunchCheckpoint, TerminalLaunchError, TerminalLaunchErrorCode, TerminalLaunchRuntime,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use crate::terminal_reconciliation::{
    RecordedSessionDecision, TerminalReconciliationReport, TerminalReconciliationService,
};
use crate::tmux_adapter::{
    ApprovedArgv, CreateOutcome, CreateSession, RuntimeIdentity, RuntimeObservation,
    TerminalGeometry, TmuxAdapter,
};
use crate::viewer_ownership::ViewerOwnershipService;

#[async_trait]
pub trait TerminalLifecycleWork: Send + Sync + 'static {
    async fn verify_schema(&self) -> Result<(), String>;
    async fn drain_spool(&self) -> Result<DrainReport, String>;
    async fn reconcile(&self) -> Result<TerminalReconciliationReport, String>;
    async fn expire_viewer_leases(&self) -> Result<u64, String>;
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
        crate::terminal_persistence::terminals_adopted(&self.database)
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
            return Err("verified terminal runtime observation is unavailable".to_owned());
        }
        Ok(report)
    }

    async fn expire_viewer_leases(&self) -> Result<u64, String> {
        self.viewers
            .expire_all()
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
                    tmux_session_name: format!("pt-{agent_run_id}"),
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
        _material: &crate::entities::terminals::launch_material::Model,
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
    pub paths: crate::launch_paths::LaunchPathsService,
    pub hook_runner: PathBuf,
    pub hook_spool_directory: PathBuf,
    pub lifecycle_url: String,
    pub mcp_url: String,
    pub backend_base_url: String,
    pub backend_api_key: String,
}

/// Interactive launches materialize approved provider argv in Rust and create
/// the verified tmux runtime directly.
#[derive(Clone)]
pub struct InteractiveTerminalLaunchRuntime {
    authority: Arc<std::sync::OnceLock<TerminalRuntimeAuthority>>,
}

impl InteractiveTerminalLaunchRuntime {
    pub fn new() -> Self {
        Self {
            authority: Arc::new(std::sync::OnceLock::new()),
        }
    }

    pub fn configure(&self, authority: TerminalRuntimeAuthority) {
        let _ = self.authority.set(authority);
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
        request: &crate::terminal_launch::CreateTerminalSession,
    ) -> Result<(), TerminalLaunchError> {
        let authority = self.authority.get().ok_or_else(|| {
            TerminalLaunchError::new(
                TerminalLaunchErrorCode::RuntimeUnavailable,
                "The Rust terminal launch authority is not ready.",
            )
        })?;
        authority
            .paths
            .preflight_module_folder(&request.module_id)
            .map(drop)
            .map_err(|failure| {
                TerminalLaunchError::new(TerminalLaunchErrorCode::UnusableFolder, failure.message())
            })
    }

    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        RecoveryTerminalLaunchRuntime.observe(agent_run_id).await
    }

    async fn materialize_and_create(
        &self,
        material: &crate::entities::terminals::launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        let authority = self.authority.get().ok_or_else(|| {
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
            let working_directory = authority
                .paths
                .preflight_module_folder(&material.module_id)
                .map_err(|failure| {
                    TerminalLaunchError::new(
                        TerminalLaunchErrorCode::UnusableFolder,
                        failure.message(),
                    )
                })?;
            let command =
                crate::terminal_launch::login_shell::approved_login_shell(working_directory)?;
            return create_tmux_runtime(material, checkpoint, command).await;
        }
        let provider = crate::launch_planning::Provider::try_from(
            material.provider.as_deref().unwrap_or_default(),
        )
        .map_err(planning_error)?;
        let scope = match material.scope.as_str() {
            "task" => crate::launch_paths::LaunchScope::Task,
            "plan" => crate::launch_paths::LaunchScope::Plan,
            "instant" => crate::launch_paths::LaunchScope::Instant,
            "docchat" => crate::launch_paths::LaunchScope::Docchat,
            _ => return Err(invalid_launch("The terminal launch scope is unsupported.")),
        };
        let paths = authority
            .paths
            .resolve(crate::launch_paths::LaunchPathsRequest {
                version: 1,
                scope,
                agent_run_id: material.agent_run_id.clone(),
                project_id: material.project_id.clone(),
                module_id: Some(material.module_id.clone()),
                task_id: matches!(scope, crate::launch_paths::LaunchScope::Task)
                    .then(|| material.issue_id.clone()),
                document_id: matches!(scope, crate::launch_paths::LaunchScope::Docchat)
                    .then(|| material.task_id.clone()),
            })
            .await
            .map_err(|_| invalid_launch("The terminal launch directory is unavailable."))?;
        let working_directory = paths
            .working_directory
            .map(PathBuf::from)
            .ok_or_else(|| invalid_launch("No local folder is configured for this launch."))?;
        authority
            .paths
            .preflight_module_folder(&material.module_id)
            .map_err(|failure| {
                TerminalLaunchError::new(TerminalLaunchErrorCode::UnusableFolder, failure.message())
            })?;
        let resume = if let Some(source_id) = material.resume_from_agent_run_id.as_deref() {
            let source = crate::entities::runs::agent_run::Entity::find_by_id(source_id)
                .one(&authority.database)
                .await
                .map_err(|_| invalid_launch("The resume source is unavailable."))?
                .ok_or_else(|| invalid_launch("The resume source is unavailable."))?;
            let provider_session_id = source.provider_session_id.ok_or_else(|| {
                invalid_launch("The resume source has no provider conversation identity.")
            })?;
            Some(crate::launch_planning::LaunchKind::Resume {
                provider_session_id,
            })
        } else {
            None
        };
        let kind = resume.unwrap_or(match material.scope.as_str() {
            "task" => crate::launch_planning::LaunchKind::Task,
            "plan" => crate::launch_planning::LaunchKind::Planning,
            "instant" => crate::launch_planning::LaunchKind::Instant,
            "docchat" => crate::launch_planning::LaunchKind::DocumentChat,
            _ => crate::launch_planning::LaunchKind::Automation,
        });
        let workspace = match material.scope.as_str() {
            "plan" | "instant" => crate::launch_planning::WorkspaceIdentity::Scratch {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                agent_run_id: material.agent_run_id.clone(),
            },
            "docchat" => crate::launch_planning::WorkspaceIdentity::Document {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                document_id: material.design_directory_identity.clone().ok_or_else(|| {
                    invalid_launch("The document launch identity is unavailable.")
                })?,
            },
            _ => crate::launch_planning::WorkspaceIdentity::Task {
                project_id: material.project_id.clone(),
                module_id: material.module_id.clone(),
                task_id: material.task_id.clone(),
            },
        };
        let durable = crate::launch_planning::DurableLaunchMaterial::new(
            material.agent_run_id.clone(),
            kind,
            provider,
            crate::launch_planning::ProviderOptions {
                model: material.model.clone(),
                reasoning: material.reasoning.clone(),
            },
            material.prompt.clone(),
            serde_json::from_value(material.required_skills.clone())
                .map_err(|_| invalid_launch("The terminal launch skill selection is invalid."))?,
            workspace,
            material.design_directory_identity.clone(),
        );
        let authorization = issue_run_authorization(authority, &material.agent_run_id).await?;
        let tool = provider_tool(provider);
        let executable = crate::tmux_adapter::approved_tool_path(tool)
            .map_err(|_| invalid_launch("The approved provider executable is unavailable."))?;
        let execution = crate::launch_planning::ExecutionAuthority::new(
            executable,
            working_directory,
            authority.hook_runner.clone(),
            authority.hook_spool_directory.clone(),
            authority.lifecycle_url.clone(),
            authorization.clone(),
            authority.mcp_url.clone(),
            authorization,
            available_skills(),
        );
        let mut launch =
            crate::launch_planning::materialize(&durable, &execution).map_err(planning_error)?;
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
        create_tmux_runtime(material, checkpoint, command).await
    }
}

async fn create_tmux_runtime(
    material: &crate::entities::terminals::launch_material::Model,
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
        .map_err(|_| {
            TerminalLaunchError::new(
                TerminalLaunchErrorCode::RuntimeUnavailable,
                "The terminal runtime could not be created.",
            )
        })? {
        CreateOutcome::Created | CreateOutcome::Existing(RuntimeObservation::Running) => {}
        _ => return Err(invalid_launch("The terminal runtime identity conflicts.")),
    }
    checkpoint
        .checkpoint(crate::terminal_launch::TerminalLaunchBoundary::TmuxCreated)
        .await
}

fn invalid_launch(message: &'static str) -> TerminalLaunchError {
    TerminalLaunchError::new(TerminalLaunchErrorCode::InvalidRequest, message)
}

fn planning_error(error: crate::launch_planning::LaunchPlanningError) -> TerminalLaunchError {
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

fn provider_tool(
    provider: crate::launch_planning::Provider,
) -> crate::tool_discovery::SupportedTool {
    match provider {
        crate::launch_planning::Provider::Claude => crate::tool_discovery::SupportedTool::Claude,
        crate::launch_planning::Provider::Codex => crate::tool_discovery::SupportedTool::Codex,
        crate::launch_planning::Provider::Gemini => crate::tool_discovery::SupportedTool::Gemini,
        crate::launch_planning::Provider::Agy => crate::tool_discovery::SupportedTool::Agy,
    }
}

fn available_skills() -> BTreeSet<String> {
    serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../../backend/apps/terminals/agents/skills/lock.json"
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
    let response = reqwest::Client::new()
        .post(format!("{}/runs/authorization", authority.backend_base_url))
        .header("x-api-key", &authority.backend_api_key)
        .json(&serde_json::json!({"agent_run_id": agent_run_id}))
        .send()
        .await
        .map_err(|_| invalid_launch("Run authorization is unavailable."))?;
    if !response.status().is_success() {
        return Err(invalid_launch("Run authorization was refused."));
    }
    response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|value| {
            value
                .get("authorization")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .ok_or_else(|| invalid_launch("Run authorization returned an invalid response."))
}

pub fn hook_spool_directory(data_directory: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(data_directory.to_string_lossy().as_bytes());
    let identity = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    std::env::temp_dir().join(format!("ticketry-hook-spool-{identity}"))
}
