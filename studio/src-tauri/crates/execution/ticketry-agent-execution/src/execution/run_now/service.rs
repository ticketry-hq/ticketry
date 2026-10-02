use std::sync::Arc;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use ticketry_entities::{issue, issue_type, issue_type_transition, state, transition_occurrence};
use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::commands::{
    status_facts::WorkFactRecorder,
    workflow::{
        self, TransitionCausation, TransitionExpectation, TransitionOrigin, TransitionWorkItem,
    },
};
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};
use ticketry_work_management::read_queries;

use super::launcher::{RunNowLauncher, TerminalRunNowLauncher};
use super::refusals::{
    identity_conflict, implementation_not_configured, launch_failure, not_eligible,
    policy_refusal, refusal, storage_refusal, transition_refusal,
};
use super::{
    RunNowCaller, RunNowIssueType, RunNowRefusal, RunNowRequest, RunNowState, RunNowSuccess,
};

#[derive(Clone)]
pub struct RunNowService {
    database: DatabaseConnection,
    policy: LaunchPolicyResolver,
    launcher: Arc<dyn RunNowLauncher>,
    facts: Option<WorkFactRecorder>,
}

impl RunNowService {
    pub fn new(
        database: DatabaseConnection,
        policy: LaunchPolicyResolver,
        terminals: TerminalLaunchService,
        facts: Option<WorkFactRecorder>,
    ) -> Self {
        let launcher = Arc::new(TerminalRunNowLauncher::new(database.clone(), terminals));
        Self {
            database,
            policy,
            launcher,
            facts,
        }
    }

    #[doc(hidden)]
    pub fn with_launcher(
        database: DatabaseConnection,
        policy: LaunchPolicyResolver,
        launcher: Arc<dyn RunNowLauncher>,
        facts: Option<WorkFactRecorder>,
    ) -> Self {
        Self {
            database,
            policy,
            launcher,
            facts,
        }
    }

    pub async fn execute(&self, request: RunNowRequest) -> Result<RunNowSuccess, RunNowRefusal> {
        let unresolved_target = request.id_or_key.clone();
        if !valid_request_identity(&request.request_identity) {
            return Err(refusal(
                unresolved_target,
                "request_identity_invalid",
                "Run Now requires one stable request identity.",
                Some("Retry with the same non-empty request identity."),
                None,
            ));
        }
        if matches!(
            &request.caller,
            RunNowCaller::Agent {
                authenticated_run_id
            } if authenticated_run_id.trim().is_empty()
        ) {
            return Err(refusal(
                unresolved_target,
                "caller_run_unbound",
                "Agent-origin Run Now requires the authenticated caller run.",
                Some("Call Run Now from an authenticated task run."),
                None,
            ));
        }

        let projected = read_queries::work_item(&self.database, &request.id_or_key)
            .await
            .map_err(|error| storage_refusal(&unresolved_target, error.to_string()))?
            .ok_or_else(|| {
                refusal(
                    unresolved_target.clone(),
                    "task_not_found",
                    "The Run Now target was not found.",
                    None,
                    None,
                )
            })?;
        let target_id = compact(&projected.id);
        let current = issue::Entity::find_by_id(&target_id)
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            .ok_or_else(|| {
                refusal(
                    projected.id.clone(),
                    "task_not_found",
                    "The Run Now target was not found.",
                    None,
                    None,
                )
            })?;

        let recorded = launch_policy::load_by_identity(
            &self.database,
            CallerScope::RunNow.as_str(),
            &request.request_identity,
        )
        .await
        .map_err(|error| policy_refusal(&projected.id, error))?;
        if let Some(decision) = recorded.as_ref() {
            if compact(&decision.task_id) != target_id {
                return Err(identity_conflict(projected.id));
            }
            if self
                .decision_is_claimed(decision)
                .await
                .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            {
                return self.launch_committed(projected.id, decision).await;
            }
        }

        let kind = issue_type::Entity::find_by_id(&current.issue_type_id)
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            .ok_or_else(|| not_eligible(&projected.id))?;
        let source = current
            .state_id
            .as_deref()
            .map(|id| state::Entity::find_by_id(id))
            .ok_or_else(|| not_eligible(&projected.id))?
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            .ok_or_else(|| not_eligible(&projected.id))?;
        if current.is_archived || kind.name != "Story" || source.name != "Ideas" {
            return Err(not_eligible(&projected.id));
        }
        workflow::refuse_run_now_with_subtasks(&self.database, &target_id)
            .await
            .map_err(|error| transition_refusal(&projected.id, error))?;
        let destination = state::Entity::find()
            .filter(state::Column::ProjectId.eq(&current.project_id))
            .filter(state::Column::Name.eq("Implement"))
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            .ok_or_else(|| {
                refusal(
                    projected.id.clone(),
                    "binding_not_configured",
                    "The project has no Implement destination for Run Now.",
                    Some("Configure the Story workflow and the Implementation Implement binding."),
                    None,
                )
            })?;
        let edge = issue_type_transition::Entity::find()
            .filter(issue_type_transition::Column::IssueTypeId.eq(&kind.id))
            .filter(issue_type_transition::Column::FromStateId.eq(&source.id))
            .filter(issue_type_transition::Column::ToStateId.eq(&destination.id))
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
            .ok_or_else(|| not_eligible(&projected.id))?;
        let conversion =
            workflow::run_now_destination_type(&self.database, &current.project_id, &destination.id)
                .await
                .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
                .ok_or_else(|| implementation_not_configured(&projected.id))?;
        let origin = match &request.caller {
            RunNowCaller::Human => TransitionOrigin::Human,
            RunNowCaller::Agent { .. } => TransitionOrigin::Agent,
        };
        if origin == TransitionOrigin::Agent && !edge.agent_allowed {
            return Err(refusal(
                projected.id,
                "human_only_transition",
                "The Ideas to Implement workflow edge is human-only.",
                Some("Ask a human caller to start this Story."),
                None,
            ));
        }

        let decision = match recorded {
            Some(decision) => decision,
            None => {
                // The launch runs as the converted Implementation task, so its
                // binding, not the Story's, selects and validates the agent.
                let decision = self
                    .policy
                    .resolve_as_issue_type(
                        LaunchPolicyRequest {
                            task_id: target_id.clone(),
                            destination_state_id: Some(destination.id.clone()),
                            provider_override: None,
                            caller_scope: CallerScope::RunNow,
                            idempotency_key: request.request_identity.clone(),
                            handoff: false,
                        },
                        &conversion.id,
                    )
                    .await
                    .map_err(|error| policy_refusal(&projected.id, error))?;
                launch_policy::record(&self.database, &decision)
                    .await
                    .map_err(|error| policy_refusal(&projected.id, error))?
            }
        };
        if compact(&decision.task_id) != target_id
            || compact(&decision.state_id) != compact(&destination.id)
            || compact(&decision.issue_type_id) != compact(&conversion.id)
        {
            return Err(identity_conflict(projected.id));
        }

        let transition = workflow::transition_with_expectation(
            &self.database,
            TransitionWorkItem {
                id: target_id,
                target_state_id: destination.id,
                origin,
            },
            Some(TransitionExpectation {
                source_state_id: source.id,
                work_item_revision: current.state_revision,
                workflow_revision: kind.workflow_revision,
                request_identity: request.request_identity,
                causation: TransitionCausation::RunNow {
                    launch_policy_decision_id: decision.decision_id.clone(),
                    destination_issue_type_id: conversion.id,
                    destination_workflow_revision: decision.policy_version,
                },
            }),
            self.facts.as_ref(),
        )
        .await;
        if let Err(error) = transition {
            if self
                .decision_is_claimed(&decision)
                .await
                .map_err(|storage| storage_refusal(&projected.id, storage.to_string()))?
            {
                return self.launch_committed(projected.id, &decision).await;
            }
            return Err(transition_refusal(&projected.id, error));
        }

        self.launch_committed(projected.id, &decision).await
    }

    async fn decision_is_claimed(
        &self,
        decision: &launch_policy::LaunchPolicyDecision,
    ) -> Result<bool, sea_orm::DbErr> {
        transition_occurrence::Entity::find()
            .filter(transition_occurrence::Column::RunNowDecisionId.eq(&decision.decision_id))
            .filter(transition_occurrence::Column::IssueId.eq(compact(&decision.task_id)))
            .filter(transition_occurrence::Column::ToStateId.eq(compact(&decision.state_id)))
            .one(&self.database)
            .await
            .map(|row| row.is_some())
    }

    async fn committed_issue_type(
        &self,
        target_id: &str,
        decision: &launch_policy::LaunchPolicyDecision,
    ) -> Result<RunNowIssueType, RunNowRefusal> {
        let kind = issue_type::Entity::find_by_id(compact(&decision.issue_type_id))
            .one(&self.database)
            .await
            .map_err(|error| storage_refusal(target_id, error.to_string()))?;
        Ok(RunNowIssueType {
            id: canonical(&decision.issue_type_id),
            name: kind.map_or_else(|| "Implementation".to_owned(), |kind| kind.name),
        })
    }

    async fn launch_committed(
        &self,
        target_id: String,
        decision: &launch_policy::LaunchPolicyDecision,
    ) -> Result<RunNowSuccess, RunNowRefusal> {
        let committed = RunNowState {
            id: canonical(&decision.state_id),
            name: decision
                .state_name
                .clone()
                .unwrap_or_else(|| "Implement".to_owned()),
        };
        let converted = self.committed_issue_type(&target_id, decision).await?;
        let run = self.launcher.launch(decision).await.map_err(|code| {
            launch_failure(
                target_id.clone(),
                &code,
                committed.clone(),
                converted.clone(),
            )
        })?;
        launch_policy::mark_delivered(&self.database, &decision.decision_id)
            .await
            .map_err(|error| policy_refusal(&target_id, error))?;
        Ok(RunNowSuccess {
            target_id,
            code: "run_now_started".to_owned(),
            detail: "The Story became an Implementation task in Implement and its agent started."
                .to_owned(),
            remedy: None,
            committed_state: committed,
            committed_issue_type: converted,
            run,
        })
    }
}

fn valid_request_identity(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 255 && !value.chars().any(char::is_control)
}

fn compact(value: &str) -> String {
    value.replace('-', "").to_lowercase()
}

fn canonical(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|id| id.to_string())
        .unwrap_or_else(|_| value.to_owned())
}
