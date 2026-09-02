use std::sync::Arc;

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::execution::graph::has_live_work;
use ticketry_entities::{issue, issue_type, issue_type_transition, state, transition_occurrence};
use ticketry_terminal::TerminalLaunchService;
use ticketry_work_management::commands::{
    status_facts::WorkFactRecorder,
    workflow::{
        self, TransitionCausation, TransitionExpectation, TransitionOrigin, TransitionWorkItem,
    },
    CommandError,
};
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyError, LaunchPolicyRequest, LaunchPolicyResolver,
};
use ticketry_work_management::read_queries;

use super::launcher::{RunNowLauncher, TerminalRunNowLauncher};
use super::{RunNowCaller, RunNowRefusal, RunNowRequest, RunNowState, RunNowSuccess};

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

        if has_live_work(&self.database, &target_id, request.caller.excluded_run_id())
            .await
            .map_err(|error| storage_refusal(&projected.id, error.to_string()))?
        {
            return Err(refusal(
                projected.id,
                "task_already_active",
                "Another live run or terminal already owns this Work Item.",
                Some("End the other live work before trying Run Now again."),
                None,
            ));
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
                    Some("Configure the Story workflow and its Implement launch binding."),
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
                let decision = self
                    .policy
                    .resolve(LaunchPolicyRequest {
                        task_id: target_id.clone(),
                        destination_state_id: Some(destination.id.clone()),
                        provider_override: None,
                        caller_scope: CallerScope::RunNow,
                        idempotency_key: request.request_identity.clone(),
                        handoff: false,
                    })
                    .await
                    .map_err(|error| policy_refusal(&projected.id, error))?;
                launch_policy::record(&self.database, &decision)
                    .await
                    .map_err(|error| policy_refusal(&projected.id, error))?
            }
        };
        if compact(&decision.task_id) != target_id
            || compact(&decision.state_id) != compact(&destination.id)
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
        let run = self.launcher.launch(decision).await.map_err(|code| {
            refusal(
                target_id.clone(),
                normalize_launch_code(&code),
                "The workflow move committed, but terminal launch did not settle.",
                Some("Retry launch reconciliation for this committed Story."),
                Some(committed.clone()),
            )
        })?;
        launch_policy::mark_delivered(&self.database, &decision.decision_id)
            .await
            .map_err(|error| policy_refusal(&target_id, error))?;
        Ok(RunNowSuccess {
            target_id,
            code: "run_now_started".to_owned(),
            detail: "The Story moved to Implement and its task agent started.".to_owned(),
            remedy: None,
            committed_state: committed,
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

fn not_eligible(target: &str) -> RunNowRefusal {
    refusal(
        target.to_owned(),
        "run_now_not_eligible",
        "Run Now requires an unarchived Story in Ideas with an Implement edge.",
        Some("Refresh the Story and its workflow before trying again."),
        None,
    )
}

fn identity_conflict(target_id: String) -> RunNowRefusal {
    refusal(
        target_id,
        "request_identity_conflict",
        "This Run Now request identity is already bound to another target or destination.",
        Some("Start the distinct action with a new request identity."),
        None,
    )
}

fn policy_refusal(target: &str, error: LaunchPolicyError) -> RunNowRefusal {
    let code = match error.code() {
        "module_not_found" => "module_id_required",
        value => value,
    };
    refusal(
        target.to_owned(),
        code,
        error.to_string(),
        policy_remedy(code),
        None,
    )
}

fn policy_remedy(code: &str) -> Option<&'static str> {
    match code {
        "module_id_required" => Some("Place the Story under an active module."),
        "binding_not_configured" | "prompt_not_configured" => {
            Some("Configure the Story's Implement launch binding.")
        }
        "module_folder_unusable" => Some("Configure an existing writable module folder."),
        "provider_not_activated" | "unknown_agent" | "agent_not_configured" => {
            Some("Activate and select a supported provider.")
        }
        "unsupported_model" | "model_required" | "unsupported_reasoning" => {
            Some("Choose a supported model and reasoning level.")
        }
        "invalid_required_skills" => Some("Fix the binding's required skills."),
        _ => None,
    }
}

fn transition_refusal(target: &str, error: CommandError) -> RunNowRefusal {
    let code = match error.code() {
        "human_only_transition" => "human_only_transition",
        _ => "transition_rejected",
    };
    refusal(
        target.to_owned(),
        code,
        error.to_string(),
        Some("Refresh the Story and retry only if it is still eligible."),
        None,
    )
}

fn storage_refusal(target: &str, detail: String) -> RunNowRefusal {
    refusal(
        target.to_owned(),
        "run_now_unavailable",
        detail,
        Some("Retry when WorkTracker storage is available."),
        None,
    )
}

fn normalize_launch_code(code: &str) -> &str {
    match code {
        "module_folder_unusable" => "module_folder_unusable",
        _ => "launch_unavailable",
    }
}

fn refusal(
    target_id: String,
    code: impl Into<String>,
    detail: impl Into<String>,
    remedy: Option<&str>,
    committed_state: Option<RunNowState>,
) -> RunNowRefusal {
    RunNowRefusal {
        target_id,
        code: code.into(),
        detail: detail.into(),
        remedy: remedy.map(str::to_owned),
        committed_state,
        run: None,
    }
}
