use sea_orm::DatabaseConnection;

use crate::settings_persistence::ProfileStore;

use super::catalog::CatalogReader;
use super::context::LaunchContextReader;
use super::rows::{canonical_uuid, PolicyReader};
use super::skills::validate_skills;
use super::types::DECISION_VERSION;
use super::{CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest};

#[derive(Clone)]
pub struct LaunchPolicyResolver {
    database: DatabaseConnection,
    profiles: ProfileStore,
}

impl LaunchPolicyResolver {
    pub fn new(database: DatabaseConnection, profiles: ProfileStore) -> Self {
        Self { database, profiles }
    }

    pub async fn resolve(
        &self,
        request: LaunchPolicyRequest,
    ) -> Result<LaunchPolicyDecision, LaunchPolicyError> {
        let policy = PolicyReader::new(&self.database);
        let task = policy.task(&request.task_id).await?;
        let state_id = request
            .destination_state_id
            .as_deref()
            .or(task.state_id.as_deref())
            .ok_or_else(|| {
                rejected(
                    "launch_context_incomplete",
                    "A current state is required to resolve agent launch configuration.",
                )
            })?;
        let binding = policy
            .binding(&task.issue_type_id, state_id)
            .await?
            .ok_or_else(binding_missing)?;
        if !binding.has_policy() {
            return Err(binding_missing());
        }
        let prompt = binding.prompt.trim().to_owned();
        if prompt.is_empty() {
            return Err(rejected(
                "prompt_not_configured",
                "This launch binding has no resolved prompt; an agent cannot be launched.",
            ));
        }
        let required_skills = validate_skills(&binding.required_skills)?;
        enforce_door_gate(
            request.caller_scope,
            binding.auto_start,
            binding.subtree_run_enabled,
        )?;

        let selection = CatalogReader::new(&self.database)
            .resolve(&binding, request.provider_override.as_deref())
            .await?;
        if request.caller_scope.unattended() && !selection.supports_unattended {
            return Err(rejected(
                "unattended_launch_unsupported",
                format!(
                    "Agent/provider '{}' cannot launch unattended.",
                    selection.provider
                ),
            ));
        }
        let (selected_profile, module_link) =
            LaunchContextReader::new(&self.database, &self.profiles)
                .resolve(&task)
                .await?;

        Ok(LaunchPolicyDecision {
            version: DECISION_VERSION,
            decision_id: uuid::Uuid::new_v4().simple().to_string(),
            policy_identity: format!("launch-binding:{}", binding.id),
            policy_version: task.workflow_revision,
            caller_scope: request.caller_scope,
            idempotency_key: request.idempotency_key,
            task_id: canonical_uuid(&task.id),
            project_id: canonical_uuid(&task.project_id),
            issue_type_id: canonical_uuid(&task.issue_type_id),
            state_id: canonical_uuid(state_id),
            prompt,
            required_skills,
            provider: selection.provider,
            model: selection.model,
            reasoning: selection.reasoning,
            selected_profile,
            module_link,
        })
    }
}

fn enforce_door_gate(
    scope: CallerScope,
    auto_start: bool,
    subtree_run_enabled: bool,
) -> Result<(), LaunchPolicyError> {
    match scope {
        CallerScope::AutoStart if !auto_start => Err(rejected(
            "auto_start_not_enabled",
            "Auto-start is not enabled for this launch binding.",
        )),
        CallerScope::Subtree if !subtree_run_enabled => Err(rejected(
            "subtree_run_not_enabled",
            "Subtree execution is not enabled for this launch binding.",
        )),
        _ => Ok(()),
    }
}

fn binding_missing() -> LaunchPolicyError {
    rejected(
        "binding_not_configured",
        "No agent launch binding is configured for this work-item type and current state.",
    )
}

fn rejected(code: &'static str, message: impl Into<String>) -> LaunchPolicyError {
    LaunchPolicyError::rejected(code, message)
}
