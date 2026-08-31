//! Delivering one durable launch policy decision to the terminal owner.
//!
//! Work management decides *whether* a run may start and records the
//! decision; carrying that decision to the Terminal Launch Service is
//! agent execution's job, above terminal rather than below it.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::terminal::launch::TerminalLaunchService;
use ticketry_entities::runs::automation_attempt;
use ticketry_launch::authority::{compose_task_prompt, TaskPromptSource};
use ticketry_launch::terminal_session::{CreateTerminalSession, TerminalLaunchKind};

use ticketry_work_management::work_management::launch_policy::{
    mark_delivered, CallerScope, LaunchPolicyDecision,
};

/// Prepare one durable policy decision through the Rust Terminal owner, then
/// mark it delivered before attempting the recoverable external effect.
pub async fn execute(
    database: &DatabaseConnection,
    service: &TerminalLaunchService,
    decision: &LaunchPolicyDecision,
) -> Result<ticketry_entities::terminals::session::Model, String> {
    ticketry_diagnostics::launch_trace::requested_by(
        decision.caller_scope.into(),
        execute_traced(database, service, decision),
    )
    .await
}

async fn execute_traced(
    database: &DatabaseConnection,
    service: &TerminalLaunchService,
    decision: &LaunchPolicyDecision,
) -> Result<ticketry_entities::terminals::session::Model, String> {
    if let Some(attempt) = ticketry_diagnostics::launch_trace::current() {
        attempt.note(|facts| {
            facts.work_item_id = Some(decision.task_id.clone());
            facts.provider = Some(decision.provider.clone());
            facts.scope = Some(decision.caller_scope.as_str().to_owned());
        });
    }
    ticketry_diagnostics::launch_trace::admitted(
        ticketry_diagnostics::launch_trace::stages::POLICY_EVALUATED,
    )
    .with("decisionId", decision.decision_id.clone())
    .record();
    let kind = if matches!(
        decision.caller_scope,
        CallerScope::Interactive | CallerScope::RunNow
    ) {
        TerminalLaunchKind::Task
    } else {
        TerminalLaunchKind::Automation
    };
    let automation_attempt_id = match decision.caller_scope {
        CallerScope::AutoStart => Some(
            automation_attempt::Entity::find()
                .filter(
                    automation_attempt::Column::TransitionId
                        .eq(decision.idempotency_key.replace('-', "")),
                )
                .filter(automation_attempt::Column::RetryOfId.is_null())
                .one(database)
                .await
                .map_err(|error| error.to_string())?
                .map(|attempt| attempt.id)
                .ok_or_else(|| {
                    format!(
                        "launch decision {} has no root Automation Attempt",
                        decision.decision_id
                    )
                })?,
        ),
        CallerScope::Retry => Some(decision.idempotency_key.clone()),
        _ => None,
    };
    let prompt = compose_task_prompt(
        database,
        TaskPromptSource {
            task_id: &decision.task_id,
            module_id: &decision.module_link.module_id,
            local_module_folder: decision.module_link.path.as_deref().unwrap_or_default(),
            state_name: decision.state_name.as_deref(),
            workflow_prompt: &decision.prompt,
            additional_user_input: None,
            design_directory: None,
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    let accepted = service
        .prepare_policy(
            request(decision, kind, automation_attempt_id, prompt),
            decision.state_name.clone(),
        )
        .await
        .map_err(|error| error.code_str().to_owned())?;
    mark_delivered(database, &decision.decision_id)
        .await
        .map_err(|error| error.code().to_owned())?;
    service
        .execute_accepted(accepted)
        .await
        .map_err(|error| error.code_str().to_owned())
}

fn request(
    decision: &LaunchPolicyDecision,
    kind: TerminalLaunchKind,
    automation_attempt_id: Option<String>,
    prompt: String,
) -> CreateTerminalSession {
    let client_request_id = match decision.caller_scope {
        CallerScope::RunNow => decision.decision_id.clone(),
        _ => decision.idempotency_key.clone(),
    };
    CreateTerminalSession {
        client_request_id,
        project_id: decision.project_id.clone(),
        issue_id: decision.task_id.clone(),
        module_id: decision.module_link.module_id.clone(),
        target_id: decision.task_id.clone(),
        kind,
        provider: Some(decision.provider.clone()),
        model: decision.model.clone(),
        reasoning: decision.reasoning.clone(),
        policy_reference: Some(decision.policy_identity.clone()),
        prompt: Some(prompt),
        resume_from_agent_run_id: None,
        automation_attempt_id,
        required_skills: decision.required_skills.clone(),
        working_directory_identity: format!("task:{}", decision.task_id.replace('-', "")),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ticketry_work_management::work_management::launch_policy::ModuleLinkInput;

    fn decision(decision_id: &str) -> LaunchPolicyDecision {
        LaunchPolicyDecision {
            version: 2,
            decision_id: decision_id.to_owned(),
            policy_identity: "binding:1".to_owned(),
            policy_version: 7,
            caller_scope: CallerScope::RunNow,
            idempotency_key: "transport-request".to_owned(),
            task_id: "task".to_owned(),
            project_id: "project".to_owned(),
            issue_type_id: "story".to_owned(),
            state_id: "implement".to_owned(),
            state_name: Some("Implement".to_owned()),
            prompt: "Implement this Story.".to_owned(),
            required_skills: Vec::new(),
            provider: "codex".to_owned(),
            model: Some("gpt-test".to_owned()),
            reasoning: None,
            module_link: ModuleLinkInput {
                module_id: "module".to_owned(),
                path: Some("/tmp/module".to_owned()),
            },
        }
    }

    #[test]
    fn run_now_launch_identities_derive_from_the_durable_decision() {
        let first = request(
            &decision("decision-1"),
            TerminalLaunchKind::Task,
            None,
            "first prompt".to_owned(),
        );
        let replay = request(
            &decision("decision-1"),
            TerminalLaunchKind::Task,
            None,
            "first prompt".to_owned(),
        );
        let other = request(
            &decision("decision-2"),
            TerminalLaunchKind::Task,
            None,
            "other prompt".to_owned(),
        );

        assert_eq!(first.client_request_id, "decision-1");
        assert_eq!(first.agent_run_id(), replay.agent_run_id());
        assert_eq!(first.effect_id(), replay.effect_id());
        assert_ne!(first.agent_run_id(), other.agent_run_id());
        assert_ne!(first.effect_id(), other.effect_id());
    }
}
