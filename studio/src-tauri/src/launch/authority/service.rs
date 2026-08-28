use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};

use crate::entities::runs::agent_run;
use crate::launch::paths::LaunchPathsService;
use crate::launch::planning::{
    build_document_chat_prompt, build_instant_prompt, build_planning_prompt, provider_contract,
    DocumentChatPrompt, InstantPrompt, PlanningPrompt, Provider,
};
use crate::settings_persistence::ProfileStore;
use crate::terminal::launch::{CreateTerminalSession, TerminalLaunchKind};
use crate::work_management::launch_policy::{
    CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

use super::error::LaunchAuthorityError;
use super::facts;
use super::material::ResolvedLaunchMaterial;
use super::sources::{activated_provider, launch_paths, local_module_folder, submitted};
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
    profiles: ProfileStore,
    paths: LaunchPathsService,
}

impl LaunchAuthorityService {
    pub fn new(database: DatabaseConnection, profiles: ProfileStore) -> Self {
        Self {
            paths: LaunchPathsService::new(database.clone(), profiles.clone()),
            database,
            profiles,
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
        if request.resume_from_agent_run_id.is_some() {
            return self.resume(request).await;
        }
        match request.kind {
            TerminalLaunchKind::Task | TerminalLaunchKind::Automation => self.task(request).await,
            TerminalLaunchKind::Planning => self.planning(request).await,
            TerminalLaunchKind::Instant => self.instant(request).await,
            TerminalLaunchKind::DocumentChat => self.document_chat(request).await,
            TerminalLaunchKind::Shell => unreachable!("rejected above"),
        }
    }
}

impl LaunchAuthorityService {
    /// A task launch is whatever the Work Item's launch binding says it is.
    /// The caller's provider is offered as an override so the picker still
    /// chooses an agent, and the catalog decides whether that is allowed.
    async fn task(
        &self,
        request: &CreateTerminalSession,
    ) -> Result<ResolvedLaunchMaterial, LaunchAuthorityError> {
        let decision = LaunchPolicyResolver::new(self.database.clone(), self.profiles.clone())
            .resolve(LaunchPolicyRequest {
                task_id: request.issue_id.clone(),
                destination_state_id: None,
                provider_override: submitted(request.provider.as_deref()).map(str::to_owned),
                caller_scope: CallerScope::Interactive,
                idempotency_key: request.client_request_id.clone(),
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
                workflow_prompt: &decision.prompt,
                // The one thing the caller contributes to a task prompt: the
                // free text typed into the launch box, kept as user input
                // rather than as authority.
                additional_user_input: submitted(request.prompt.as_deref()),
                design_directory: paths.design_directory_relative.as_deref(),
            },
        )
        .await?;
        Ok(ResolvedLaunchMaterial {
            provider: Some(decision.provider),
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
            local_module_folder(&self.profiles, &request.module_id),
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
        let provider = activated_provider(&self.database, request.provider.as_deref()).await?;
        let user_input = submitted(request.prompt.as_deref())
            .ok_or_else(|| {
                LaunchAuthorityError::unresolvable(
                    "An instant change needs the change the user asked for.",
                )
            })?
            .to_owned();
        let paths = launch_paths(&self.paths, request).await?;
        let module = facts::module_prompt_facts(
            &self.database,
            &request.module_id,
            local_module_folder(&self.profiles, &request.module_id),
        )
        .await?;
        let contract = provider_contract(
            Provider::try_from(provider.as_str())
                .map_err(|error| LaunchAuthorityError::unresolvable(error.to_string()))?,
        );
        let prompt = build_instant_prompt(&InstantPrompt {
            module,
            user_input,
            design_directory: paths.design_directory_relative.clone(),
            allow_self_termination: contract.supports_worktracker_mcp,
        });
        Ok(self.scratch_material(provider, prompt))
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
            local_module_folder: local_module_folder(&self.profiles, &request.module_id)
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
            model: source.launch_model.or(source.model),
            reasoning: source.reasoning,
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
