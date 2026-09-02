//! Delivering one durable launch policy decision to the terminal owner.
//!
//! Work management decides *whether* a run may start and records the
//! decision; carrying that decision to the Terminal Launch Service is
//! agent execution's job, above terminal rather than below it.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use ticketry_entities::automation_attempt;
use ticketry_launch::{
    compose_task_prompt, provider_contract, CreateTerminalSession, TaskPromptSource,
    TerminalLaunchKind,
};
use ticketry_runs::{AttemptOutcome, DeliveryMode, RunsServices};
use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::launch_policy::{mark_delivered, CallerScope, LaunchPolicyDecision};

use super::handoff;

/// Prepare one durable policy decision through the Rust Terminal owner, then
/// mark it delivered before attempting the recoverable external effect.
pub async fn execute(
    database: &DatabaseConnection,
    service: &TerminalLaunchService,
    decision: &LaunchPolicyDecision,
) -> Result<ticketry_entities::session::Model, String> {
    ticketry_diagnostics::requested_by(
        decision.caller_scope.into(),
        execute_traced(database, service, decision),
    )
    .await
}

async fn execute_traced(
    database: &DatabaseConnection,
    service: &TerminalLaunchService,
    decision: &LaunchPolicyDecision,
) -> Result<ticketry_entities::session::Model, String> {
    if let Some(attempt) = ticketry_diagnostics::current() {
        attempt.note(|facts| {
            facts.work_item_id = Some(decision.task_id.clone());
            facts.provider = Some(decision.provider.clone());
            facts.scope = Some(decision.caller_scope.as_str().to_owned());
        });
    }
    ticketry_diagnostics::admitted(ticketry_diagnostics::POLICY_EVALUATED)
        .with("decisionId", decision.decision_id.clone())
        .record();
    ticketry_diagnostics::LaunchRequestedRecord {
        launch_attempt_id: launch_attempt_id(decision),
        surface: request_surface(decision.caller_scope),
        project_id: Some(&decision.project_id),
        work_item_id: Some(&decision.task_id),
        provider_slug: Some(&decision.provider),
        model: decision.model.as_deref(),
        reasoning_level: decision.reasoning.as_deref(),
        scope: Some("task"),
    }
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
    if decision.handoff {
        if let Some(live) = handoff::live_agent_session(database, &decision.task_id)
            .await
            .map_err(|error| error.to_string())?
        {
            // The decision is spent the moment typed delivery begins. Marking
            // it delivered first is what stops a replay from pasting the
            // destination prompt into the same session twice.
            mark_delivered(database, &decision.decision_id)
                .await
                .map_err(|error| error.code().to_owned())?;
            let delivered = handoff::deliver(&live, prompt, decision.entry_skill.clone()).await;
            if delivered.is_ok() {
                record_delivery_mode(
                    database,
                    automation_attempt_id.as_deref(),
                    DeliveryMode::Continued,
                )
                .await?;
            }
            // A continued handoff mints no Launch Effect, so nothing else will
            // ever settle its Automation Attempt. Typed delivery is the whole
            // of the attempt's work: its outcome settles it here, or the
            // attempt stays pending for good.
            settle_handoff_attempt(
                database,
                automation_attempt_id.as_deref(),
                &live,
                delivered.as_ref().err().map(String::as_str),
                decision.caller_scope != CallerScope::Retry,
            )
            .await?;
            delivered?;
            return session_of(database, &live.agent_run_id).await;
        }
    }
    let accepted = service
        .prepare_policy(
            request(decision, kind, automation_attempt_id.clone(), prompt),
            decision.state_name.clone(),
        )
        .await
        .map_err(|error| error.code_str().to_owned())?;
    mark_delivered(database, &decision.decision_id)
        .await
        .map_err(|error| error.code().to_owned())?;
    let session = service
        .execute_accepted(accepted)
        .await
        .map_err(|error| error.code_str().to_owned())?;
    record_delivery_mode(
        database,
        automation_attempt_id.as_deref(),
        DeliveryMode::StartedFresh,
    )
    .await?;
    Ok(session)
}

/// Settle the Automation Attempt a continued handoff owns. A typed delivery
/// that reached the session is the attempt succeeding in that session; one
/// that did not is retryable only on the original attempt. A failed retry is
/// terminal so the status feed cannot offer a second retry.
async fn settle_handoff_attempt(
    database: &DatabaseConnection,
    automation_attempt_id: Option<&str>,
    live: &handoff::LiveAgentSession,
    failure: Option<&str>,
    retryable: bool,
) -> Result<(), String> {
    let Some(attempt_id) = automation_attempt_id else {
        return Ok(());
    };
    let outcome = match failure {
        None => AttemptOutcome::Succeeded {
            agent: provider_contract(live.provider).slug.to_owned(),
            agent_run_id: live.agent_run_id.clone(),
        },
        Some(detail) => AttemptOutcome::Failed {
            error: "The destination could not be typed into the live session.".to_owned(),
            failure: serde_json::json!({
                "code": "handoff_delivery_failed",
                "detail": detail,
            }),
            retryable,
        },
    };
    RunsServices::new(database.clone())
        .attempts()
        .record_outcome(attempt_id, outcome)
        .await
        .map(drop)
        .map_err(|error| error.to_string())
}

/// Record on the durable Automation Attempt whether the destination continued
/// a live session or started a fresh one. Callers with no attempt — an
/// interactive or Run Now launch — have no automation lineage to annotate.
async fn record_delivery_mode(
    database: &DatabaseConnection,
    automation_attempt_id: Option<&str>,
    mode: DeliveryMode,
) -> Result<(), String> {
    let Some(attempt_id) = automation_attempt_id else {
        return Ok(());
    };
    RunsServices::new(database.clone())
        .attempts()
        .record_delivery_mode(attempt_id, mode)
        .await
        .map(drop)
        .map_err(|error| error.to_string())
}

/// The session a handoff continued. It already exists, so a handoff returns
/// the same shape a fresh launch does without minting anything.
async fn session_of(
    database: &DatabaseConnection,
    agent_run_id: &str,
) -> Result<ticketry_entities::session::Model, String> {
    ticketry_entities::session::Entity::find_by_id(agent_run_id)
        .one(database)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("continued session {agent_run_id} is no longer recorded"))
}

fn request(
    decision: &LaunchPolicyDecision,
    kind: TerminalLaunchKind,
    automation_attempt_id: Option<String>,
    prompt: String,
) -> CreateTerminalSession {
    CreateTerminalSession {
        client_request_id: launch_attempt_id(decision).to_owned(),
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

fn launch_attempt_id(decision: &LaunchPolicyDecision) -> &str {
    match decision.caller_scope {
        CallerScope::RunNow => &decision.decision_id,
        _ => &decision.idempotency_key,
    }
}

fn request_surface(scope: CallerScope) -> ticketry_diagnostics::LaunchRequestSurface {
    match scope {
        CallerScope::Interactive => ticketry_diagnostics::LaunchRequestSurface::DefaultCodingAgent,
        CallerScope::RunNow => ticketry_diagnostics::LaunchRequestSurface::RunNow,
        CallerScope::AutoStart | CallerScope::Retry => {
            ticketry_diagnostics::LaunchRequestSurface::WorkflowAutoStart
        }
        CallerScope::Subtree => ticketry_diagnostics::LaunchRequestSurface::DependencyGraph,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ticketry_work_management::launch_policy::ModuleLinkInput;

    fn decision(decision_id: &str) -> LaunchPolicyDecision {
        LaunchPolicyDecision {
            version: 2,
            decision_id: decision_id.to_owned(),
            policy_identity: "binding:1".to_owned(),
            policy_version: 7,
            caller_scope: CallerScope::RunNow,
            idempotency_key: "transport-request".to_owned(),
            handoff: false,
            task_id: "task".to_owned(),
            project_id: "project".to_owned(),
            issue_type_id: "story".to_owned(),
            state_id: "implement".to_owned(),
            state_name: Some("Implement".to_owned()),
            prompt: "Implement this Story.".to_owned(),
            required_skills: Vec::new(),
            entry_skill: Some("tdd".to_owned()),
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
