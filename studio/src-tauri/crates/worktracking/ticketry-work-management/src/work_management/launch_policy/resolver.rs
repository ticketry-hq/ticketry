use sea_orm::DatabaseConnection;

use super::catalog::CatalogReader;
use super::context::LaunchContextReader;
use super::rows::{canonical_uuid, PolicyReader};
use super::skills::validate_skills;
use super::types::DECISION_VERSION;
use super::{CallerScope, LaunchPolicyDecision, LaunchPolicyError, LaunchPolicyRequest};

#[derive(Clone)]
pub struct LaunchPolicyResolver {
    database: DatabaseConnection,
}

impl LaunchPolicyResolver {
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    /// Resolves one launch policy request.
    ///
    /// A refusal is traced here: no launch follows it, so this is the only
    /// place the refusal can be observed. An admission is traced by the
    /// delivery that carries the decision, under that launch's own attempt.
    pub async fn resolve(
        &self,
        request: LaunchPolicyRequest,
    ) -> Result<LaunchPolicyDecision, LaunchPolicyError> {
        let scope = request.caller_scope;
        let task_id = request.task_id.clone();
        let outcome = self.resolve_inner(request).await;
        if let Err(error) = &outcome {
            ticketry_diagnostics::requested_by(scope.into(), async {
                if let Some(attempt) = ticketry_diagnostics::current() {
                    attempt.note(|facts| {
                        facts.work_item_id = Some(task_id);
                        facts.scope = Some(scope.as_str().to_owned());
                    });
                }
                ticketry_diagnostics::refused(ticketry_diagnostics::POLICY_EVALUATED, error.code())
                    .record();
            })
            .await;
        }
        outcome
    }

    async fn resolve_inner(
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
        let state_name = policy.state_name(&task.project_id, state_id).await?;
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
        let module_link = LaunchContextReader::new(&self.database)
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
            state_name: Some(state_name),
            prompt,
            required_skills,
            provider: selection.provider,
            model: selection.model,
            reasoning: selection.reasoning,
            module_link,
        })
    }
}

fn enforce_door_gate(
    scope: CallerScope,
    _auto_start: bool,
    subtree_run_enabled: bool,
) -> Result<(), LaunchPolicyError> {
    match scope {
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
