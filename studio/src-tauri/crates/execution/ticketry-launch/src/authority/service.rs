use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::paths::LaunchPathsService;
use crate::planning::{
    build_document_chat_prompt, build_instant_prompt, build_planning_prompt, provider_contract,
    DocumentChatPrompt, InstantPrompt, PlanningPrompt, Provider,
};
use crate::terminal_session::{CreateTerminalSession, TerminalLaunchKind};
use ticketry_entities::{agent_run, launch_material};
use ticketry_work_management::launch_policy::{
    CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

use super::error::LaunchAuthorityError;
use super::facts;
use super::material::ResolvedLaunchMaterial;
use super::sources::{
    activated_provider, default_scratch_launch, launch_paths, local_module_folder, submitted,
};
use super::task_prompt::{compose_task_prompt, TaskPromptSource};

/// The seam the Terminal Launch service resolves an interactive request
/// through. It exists as a trait so the launch service depends on the policy
/// question, not on WorkTracker, Settings, Documents, and Worktrees.
#[async_trait]
pub trait InteractiveLaunchAuthority: Send + Sync + 'static {
    async fn resolve(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError>;
}

/// Resolves one interactive launch into the material it is allowed to run
/// with, from WorkTracker launch policy, the selected profile, the document
/// registry, and the run's worktree-derived directories.
#[derive(Clone)]
pub struct LaunchAuthorityService {
    database: DatabaseConnection,
    paths: LaunchPathsService,
}

impl LaunchAuthorityService {
    pub fn new(database: DatabaseConnection) -> Self {
        Self {
            paths: LaunchPathsService::new(database.clone()),
            database,
        }
    }
}

#[async_trait]
impl InteractiveLaunchAuthority for LaunchAuthorityService {
    async fn resolve(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        if request.kind == TerminalLaunchKind::Shell {
            return Err(LaunchAuthorityError::unresolvable(
                "A shell launch carries no agent material to resolve.",
            ));
        }
        let mut material = if request.resume_from_agent_run_id.is_some() {
            self.resume(request).await?
        } else {
            match request.kind {
                TerminalLaunchKind::Task | TerminalLaunchKind::Automation => {
                    self.task(request).await
                }
                TerminalLaunchKind::Planning => self.planning(request).await,
                TerminalLaunchKind::Instant => self.instant(request).await,
                TerminalLaunchKind::DocumentChat => self.document_chat(request).await,
                TerminalLaunchKind::Shell => unreachable!("rejected above"),
            }?
        };
        if material.provider.as_deref() == Some("codex") {
            // A workflow binding's profile outranks the global default; the
            // default only fills a launch that resolved without one, and it
            // never displaces an explicitly resolved model or reasoning
            // level with its own profile.
            if request.resume_from_agent_run_id.is_none()
                && material.profile.is_none()
                && material.model.is_none()
                && material.reasoning.is_none()
            {
                if let Some(default) =
                    ticketry_settings::read_global_launch_default(&self.database).await?
                {
                    if default.provider == "codex" {
                        material.profile = default.profile;
                    }
                }
            }
            if material.profile.is_some() {
                material.model = None;
                material.reasoning = None;
            }
        }
        Ok(material)
    }
}

impl LaunchAuthorityService {
    /// A task launch takes its model, reasoning, and skills from the Work
    /// Item's launch binding. Only automation receives the binding's workflow
    /// prompt; a manual picker launch starts from the factual ticket context.
    /// The caller's provider remains an override governed by the catalog.
    async fn task(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let decision = LaunchPolicyResolver::new(self.database.clone())
            .resolve(LaunchPolicyRequest {
                task_id: request.issue_id.clone(),
                destination_state_id: None,
                provider_override: submitted(request.provider.as_deref()).map(str::to_owned),
                caller_scope: CallerScope::Interactive,
                idempotency_key: request.client_request_id.clone(),
                handoff: false,
            })
            .await?;
        let paths = launch_paths(&self.paths, request).await?;
        let prompt = compose_task_prompt(
            &self.database,
            TaskPromptSource {
                task_id: &request.issue_id,
                module_id: &decision.module_link.module_id,
                local_module_folder: decision.module_link.path.as_deref().unwrap_or_default(),
                state_name: decision.state_name.as_deref(),
                workflow_prompt: if request.kind == TerminalLaunchKind::Automation {
                    decision.prompt.as_str()
                } else {
                    ""
                },
                // The one thing the caller contributes to a task prompt: the
                // free text typed into the launch box, kept as user input
                // rather than as authority.
                additional_user_input: submitted(request.prompt.as_deref()),
                design_directory: paths.design_directory_relative.as_deref(),
                design_directory_root: paths.design_directory.as_deref(),
            },
        )
        .await?;
        Ok(ResolvedLaunchMaterial {
            provider: Some(decision.provider),
            profile: decision.profile,
            model: decision.model,
            reasoning: decision.reasoning,
            policy_reference: Some(decision.policy_identity),
            prompt: Some(prompt),
            required_skills: decision.required_skills,
            design_directory_identity: None,
            document_relative_path: None,
        })
    }

    async fn planning(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let provider = activated_provider(&self.database, request.provider.as_deref()).await?;
        let paths = launch_paths(&self.paths, request).await?;
        let module = facts::module_prompt_facts(
            &self.database,
            &request.module_id,
            local_module_folder(&self.database, &request.module_id).await,
        )
        .await?;
        let prompt = build_planning_prompt(&PlanningPrompt {
            module,
            tasks: facts::module_task_summaries(&self.database, &request.module_id).await?,
            design_directory: paths.design_directory_relative.clone(),
            module_directory_name: paths.module_directory_name.clone(),
        });
        Ok(self.scratch_material(provider, prompt))
    }

    async fn instant(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let default = if submitted(request.provider.as_deref()).is_none() {
            Some(default_scratch_launch(&self.database).await?)
        } else {
            None
        };
        let provider = match &default {
            Some(default) => default.provider.clone(),
            None => activated_provider(&self.database, request.provider.as_deref()).await?,
        };
        let user_input = submitted(request.prompt.as_deref()).map(str::to_owned);
        let paths = launch_paths(&self.paths, request).await?;
        let module = facts::module_prompt_facts(
            &self.database,
            &request.module_id,
            local_module_folder(&self.database, &request.module_id).await,
        )
        .await?;
        let contract = provider_contract(
            Provider::try_from(provider.as_str())
                .map_err(|error| LaunchAuthorityError::unresolvable(error.to_string()))?,
        );
        let settings = ticketry_settings::load_instant_launch_settings(&self.database).await?;
        let prompt = build_instant_prompt(&InstantPrompt {
            module,
            user_input,
            initial_prompt: Some(settings.initial_prompt),
            design_directory: paths.design_directory_relative.clone(),
            allow_self_termination: contract.supports_worktracker_mcp,
            auto_close: settings.auto_close,
        });
        let mut material = self.scratch_material(provider, prompt);
        if let Some(default) = default {
            material.model = default.model;
            material.reasoning = default.reasoning;
        }
        Ok(material)
    }

    /// A doc-chat launch names its document from the registry, so the prompt
    /// and the persisted relative path describe the registered copy the user
    /// opened rather than a path the caller typed.
    async fn document_chat(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let provider = activated_provider(&self.database, request.provider.as_deref()).await?;
        let paths = launch_paths(&self.paths, request).await?;
        let document_relative_path = paths.document_relative_path.clone().ok_or_else(|| {
            LaunchAuthorityError::unresolvable("The launch document is not registered.")
        })?;
        let prompt = build_document_chat_prompt(&DocumentChatPrompt {
            document_relative_path: document_relative_path.clone(),
            local_module_folder: local_module_folder(&self.database, &request.module_id)
                .await
                .unwrap_or_default(),
            user_input: submitted(request.prompt.as_deref()).map(str::to_owned),
        });
        Ok(ResolvedLaunchMaterial {
            provider: Some(provider),
            prompt: Some(prompt),
            design_directory_identity: Some(facts::compact(&request.issue_id)),
            document_relative_path: Some(document_relative_path),
            ..ResolvedLaunchMaterial::default()
        })
    }

    /// Resuming continues an ended conversation: the provider argv carries the
    /// provider session identity and no prompt at all, so the material comes
    /// from the source run rather than from policy or from the caller.
    async fn resume(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let source_id = request
            .resume_from_agent_run_id
            .as_deref()
            .unwrap_or_default();
        let source = agent_run::Entity::find_by_id(source_id)
            .one(&self.database)
            .await?
            .ok_or_else(|| {
                LaunchAuthorityError::unresolvable("The resumed conversation is unavailable.")
            })?;
        let profile = launch_material::Entity::find()
            .filter(launch_material::Column::AgentRunId.eq(source_id))
            .one(&self.database)
            .await?
            .and_then(|material| material.profile);
        let document_relative_path = match request.kind {
            TerminalLaunchKind::DocumentChat => {
                launch_paths(&self.paths, request)
                    .await?
                    .document_relative_path
            }
            _ => None,
        };
        Ok(ResolvedLaunchMaterial {
            provider: source.agent,
            profile,
            model: source.launch_model,
            reasoning: source.launch_reasoning,
            policy_reference: None,
            prompt: None,
            required_skills: Vec::new(),
            design_directory_identity: (request.kind == TerminalLaunchKind::DocumentChat)
                .then(|| facts::compact(&request.issue_id)),
            document_relative_path,
        })
    }

    /// Planning, instant, and doc-chat scopes have no launch binding: the user
    /// chose the agent and there is no configured model or skill envelope.
    fn scratch_material(&self, provider: String, prompt: String) -> ResolvedLaunchMaterial {
        ResolvedLaunchMaterial {
            provider: Some(provider),
            prompt: Some(prompt),
            ..ResolvedLaunchMaterial::default()
        }
    }
}
