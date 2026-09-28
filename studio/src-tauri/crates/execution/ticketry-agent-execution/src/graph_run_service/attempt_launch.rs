//! One campaign launch attempt: sample the root's status binding, then prepare
//! and start one direct child under its campaign claim.
//!
//! The sampling boundary is `resolve_attempt_policy`, called immediately
//! before preparation. Edits after it affect only later attempts; an attempt
//! that already committed its launch material replays that material unchanged.

use sea_orm::DatabaseConnection;
use ticketry_launch::{
    compose_task_prompt, CreateTerminalSession, TaskPromptSource, TerminalLaunchKind,
};
use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::launch_policy::{
    CallerScope, LaunchPolicyDecision, LaunchPolicyRequest, LaunchPolicyResolver,
};

use super::claim::{CampaignClaim, ClaimGeneration};
use super::{GraphRunServiceError, GraphRunServiceErrorCode, LaunchedChild};

/// Resolve the root's current status binding through the shared policy
/// resolver and reject a decision outside the campaign's project and Module.
pub(super) async fn resolve_attempt_policy(
    policy: &LaunchPolicyResolver,
    root_id: &str,
    project_id: &str,
    module_id: &str,
    provider_override: Option<String>,
) -> Result<LaunchPolicyDecision, GraphRunServiceError> {
    let decision = policy
        .resolve(LaunchPolicyRequest {
            task_id: root_id.to_owned(),
            destination_state_id: None,
            provider_override,
            caller_scope: CallerScope::Subtree,
            idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
            handoff: false,
        })
        .await?;
    if compact(&decision.project_id) != compact(project_id)
        || compact(&decision.module_link.module_id) != compact(module_id)
    {
        return Err(GraphRunServiceError::new(
            GraphRunServiceErrorCode::LaunchPolicy,
            "launch_context_incomplete",
            "Launch policy resolved outside the dependency graph scope.",
        ));
    }
    Ok(decision)
}

/// Compose, prepare, and start one child. Preparation commits the Agent Run,
/// launch material, and claim together; runtime settlement is status-driven,
/// so a terminal error after that commit does not erase the accepted child.
pub(super) async fn launch_attempt(
    database: &DatabaseConnection,
    terminal_launch: &TerminalLaunchService,
    decision: &LaunchPolicyDecision,
    claim: &CampaignClaim<'_>,
    module_id: &str,
) -> Result<LaunchedChild, GraphRunServiceError> {
    let child_id = claim.child_id;
    let prompt = compose_task_prompt(
        database,
        TaskPromptSource {
            task_id: child_id,
            module_id,
            local_module_folder: decision.module_link.path.as_deref().unwrap_or_default(),
            state_name: None,
            workflow_prompt: &decision.prompt,
            stage_skills: &decision.stage_skills,
            additional_user_input: None,
            design_directory: None,
            design_directory_root: None,
        },
    )
    .await?;
    // One child is one launch attempt, and the whole attempt — its
    // preparation and its runtime — is traced under that identity.
    ticketry_diagnostics::requested_by(
        ticketry_diagnostics::LaunchSurface::DependencyGraph,
        async {
            let accepted = terminal_launch
                .prepare_with_participant(
                    terminal_request(decision, &claim.identity, child_id, module_id, prompt),
                    claim,
                )
                .await?;
            let launched = LaunchedChild {
                task_id: child_id.to_owned(),
                agent_run_id: accepted.agent_run_id.clone(),
                provider: decision.provider.clone(),
            };
            let _ = terminal_launch.execute_accepted(accepted).await;
            Ok(launched)
        },
    )
    .await
}

fn terminal_request(
    decision: &LaunchPolicyDecision,
    identity: &ClaimGeneration,
    child_id: &str,
    module_id: &str,
    prompt: String,
) -> CreateTerminalSession {
    CreateTerminalSession {
        client_request_id: identity.request_id.clone(),
        project_id: decision.project_id.clone(),
        issue_id: child_id.to_owned(),
        module_id: module_id.to_owned(),
        target_id: child_id.to_owned(),
        kind: TerminalLaunchKind::Automation,
        provider: Some(decision.provider.clone()),
        profile: decision.profile.clone(),
        model: decision.model.clone(),
        reasoning: decision.reasoning.clone(),
        policy_reference: Some(decision.policy_identity.clone()),
        prompt: Some(prompt),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: decision.required_skills.clone(),
        working_directory_identity: format!("task:{}", compact(child_id)),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 32,
    }
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
