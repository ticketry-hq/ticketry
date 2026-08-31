use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    TransactionTrait,
};

use crate::execution::graph::{
    automatic_candidates, manual_candidates, scheduling_facts, ExecutionMode, GraphAccess,
};
use crate::launch::authority::{compose_task_prompt, TaskPromptSource};
use crate::launch::terminal_session::{CreateTerminalSession, TerminalLaunchKind};
use crate::terminal::launch::TerminalLaunchService;
use crate::work_management::launch_policy::{
    CallerScope, LaunchPolicyDecision, LaunchPolicyRequest, LaunchPolicyResolver,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use ticketry_entities::{
    execution::{graph_run, launch_claim},
    work_management::issue,
};

static PRODUCTION_MUTATIONS_OPEN: AtomicBool = AtomicBool::new(false);

pub(crate) fn set_production_mutations_open(open: bool) {
    PRODUCTION_MUTATIONS_OPEN.store(open, Ordering::Release);
}

use super::claim::{serial_frontier_pending, CampaignClaim, ClaimGeneration, ClaimSelection};
use super::{
    DeletedGraphRunResult, GraphRunAdvanceResult, GraphRunRequest, GraphRunResult,
    GraphRunServiceError, GraphRunServiceErrorCode, LaunchedChild, ResetGraphRunResult,
};

#[derive(Clone)]
pub struct GraphRunService {
    database: DatabaseConnection,
    policy: LaunchPolicyResolver,
    terminal_launch: TerminalLaunchService,
    mutation_lock: Arc<tokio::sync::Mutex<()>>,
    guarded: bool,
}

/// The stored Graph Run policy snapshot's own format version. Adoption
/// preflight validates this, and it is deliberately not the workflow revision
/// the policy was resolved at: the launch-policy decision carries that under
/// its own name, and a campaign armed at any revision must still reopen.
const POLICY_SNAPSHOT_VERSION: i32 = 1;

#[derive(Serialize)]
struct GraphRunPolicySnapshot<'a> {
    policy_version: i32,
    workflow_revision: i32,
    policy_identity: &'a str,
    decision_id: &'a str,
    prompt: &'a str,
    agent: &'a str,
    model: Option<&'a str>,
    reasoning: Option<&'a str>,
    required_skills: &'a [String],
    module_id: &'a str,
    module_link_path: Option<&'a str>,
}

#[derive(Deserialize)]
struct StoredGraphRunPolicy {
    policy_identity: String,
    prompt: String,
    agent: String,
    model: Option<String>,
    reasoning: Option<String>,
    required_skills: Vec<String>,
    module_id: String,
    #[serde(default)]
    module_link_path: Option<String>,
}

impl GraphRunService {
    pub fn new(
        database: DatabaseConnection,
        policy: LaunchPolicyResolver,
        terminal_launch: TerminalLaunchService,
    ) -> Self {
        let mutation_lock = terminal_launch.graph_run_mutation_lock();
        Self {
            database,
            policy,
            terminal_launch,
            mutation_lock,
            guarded: false,
        }
    }

    pub(crate) fn production(
        database: DatabaseConnection,
        policy: LaunchPolicyResolver,
        terminal_launch: TerminalLaunchService,
    ) -> Self {
        let mutation_lock = terminal_launch.graph_run_mutation_lock();
        Self {
            database,
            policy,
            terminal_launch,
            mutation_lock,
            guarded: true,
        }
    }

    pub async fn create(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        self.require_mutations_open()?;
        let _mutation = self.mutation_lock.lock().await;
        self.require_header(&request.root_id, false).await?;
        self.create_or_press_unlocked(request).await
    }

    pub async fn update(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        self.require_mutations_open()?;
        let _mutation = self.mutation_lock.lock().await;
        self.require_header(&request.root_id, true).await?;
        self.create_or_press_unlocked(request).await
    }

    pub async fn delete(
        &self,
        root_id: &str,
        access: &crate::execution::graph::GraphAccess,
    ) -> Result<DeletedGraphRunResult, GraphRunServiceError> {
        self.require_mutations_open()?;
        let _mutation = self.mutation_lock.lock().await;
        let graph_run = self
            .require_header(root_id, true)
            .await?
            .expect("checked header");
        let reset = self.reset_unlocked(root_id, access).await?;
        Ok(DeletedGraphRunResult {
            graph_run,
            cleared_task_ids: reset.cleared_task_ids,
        })
    }

    /// Execute the MCP compatibility request against the same campaign seam as
    /// GraphQL create and update. An omitted mode retains the established
    /// parallel default.
    pub async fn execute(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        self.require_mutations_open()?;
        let _mutation = self.mutation_lock.lock().await;
        self.create_or_press_unlocked(request).await
    }

    /// Clear the campaign and immediately execute it again through the same
    /// reset and preparation rules used by the authored Graph Run contract.
    pub async fn reset_and_execute(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        self.require_mutations_open()?;
        let _mutation = self.mutation_lock.lock().await;
        self.reset_unlocked(&request.root_id, &request.access)
            .await?;
        self.create_or_press_unlocked(request).await
    }

    /// Create an unarmed root or deliberately press an existing campaign.
    ///
    /// Policy and graph validation finish before the first Graph Run write.
    /// Each child claim then commits with its Runs and Terminal launch material;
    /// runtime creation happens only after that transaction closes.
    pub async fn create_or_press(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        let _mutation = self.mutation_lock.lock().await;
        self.create_or_press_unlocked(request).await
    }

    async fn create_or_press_unlocked(
        &self,
        request: GraphRunRequest,
    ) -> Result<GraphRunResult, GraphRunServiceError> {
        let mode = request.mode.unwrap_or(ExecutionMode::Parallel);
        let initial_facts =
            scheduling_facts(&self.database, &request.root_id, &request.access, None).await?;
        let root_id = compact(&request.root_id);
        let root = issue::Entity::find_by_id(&root_id)
            .one(&self.database)
            .await?
            .ok_or_else(|| {
                GraphRunServiceError::new(
                    GraphRunServiceErrorCode::GraphFacts,
                    "task_not_found",
                    "Dependency graph root was not found.",
                )
            })?;
        let module_id = root.module_id.clone().ok_or_else(|| {
            GraphRunServiceError::new(
                GraphRunServiceErrorCode::GraphFacts,
                "module_id_required",
                "Dependency graph root has no Module scope.",
            )
        })?;
        let decision = self
            .policy
            .resolve(LaunchPolicyRequest {
                task_id: root_id.clone(),
                destination_state_id: None,
                provider_override: request.provider_override.clone(),
                caller_scope: CallerScope::Subtree,
                idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
            })
            .await?;
        if compact(&decision.project_id) != root.project_id
            || compact(&decision.module_link.module_id) != module_id
        {
            return Err(GraphRunServiceError::new(
                GraphRunServiceErrorCode::LaunchPolicy,
                "launch_context_incomplete",
                "Launch policy resolved outside the dependency graph scope.",
            ));
        }
        let policy_snapshot = serde_json::to_string(&GraphRunPolicySnapshot {
            policy_version: POLICY_SNAPSHOT_VERSION,
            workflow_revision: decision.policy_version,
            policy_identity: &decision.policy_identity,
            decision_id: &decision.decision_id,
            prompt: &decision.prompt,
            agent: &decision.provider,
            model: decision.model.as_deref(),
            reasoning: decision.reasoning.as_deref(),
            required_skills: &decision.required_skills,
            module_id: &decision.module_link.module_id,
            module_link_path: decision.module_link.path.as_deref(),
        })
        .map_err(|error| {
            GraphRunServiceError::new(
                GraphRunServiceErrorCode::LaunchPolicy,
                "launch_policy_invalid",
                format!("Launch policy could not be stored: {error}"),
            )
        })?;
        let graph_run = self
            .refresh_header(&root, &decision, mode, &policy_snapshot)
            .await?;

        let selected = manual_candidates(&initial_facts, mode)
            .into_iter()
            .map(|facts| compact(&facts.child.id))
            .collect::<Vec<_>>();
        let mut launched = Vec::with_capacity(selected.len());
        for child_id in selected {
            let identity = ClaimGeneration::next(&self.database, &root_id, &child_id).await?;
            let claim = CampaignClaim {
                root_id: &root_id,
                child_id: &child_id,
                policy_snapshot: &policy_snapshot,
                mode,
                access: &request.access,
                identity: identity.clone(),
                selection: ClaimSelection::Manual,
            };
            let prompt = compose_task_prompt(
                &self.database,
                TaskPromptSource {
                    task_id: &child_id,
                    module_id: &module_id,
                    local_module_folder: decision.module_link.path.as_deref().unwrap_or_default(),
                    state_name: None,
                    workflow_prompt: &decision.prompt,
                    additional_user_input: None,
                    design_directory: None,
                },
            )
            .await?;
            let accepted = self
                .terminal_launch
                .prepare_with_participant(
                    terminal_request(&decision, &identity, &child_id, &module_id, prompt),
                    &claim,
                )
                .await?;
            launched.push(LaunchedChild {
                task_id: child_id,
                agent_run_id: accepted.agent_run_id.clone(),
                provider: decision.provider.clone(),
            });
            // Runtime settlement is status-driven. Once preparation commits,
            // a terminal error must not erase this request's accepted child.
            let _ = self.terminal_launch.execute_accepted(accepted).await;
        }

        let graph_run = graph_run::Entity::find_by_id(&root_id)
            .one(&self.database)
            .await?
            .unwrap_or(graph_run);
        Ok(GraphRunResult {
            graph_run,
            launched,
        })
    }

    /// Re-evaluate one armed campaign from durable Work Item, Run, and Terminal
    /// facts without changing its mode or stored launch policy.
    pub async fn advance(
        &self,
        root_id: &str,
    ) -> Result<GraphRunAdvanceResult, GraphRunServiceError> {
        let _mutation = self.mutation_lock.lock().await;
        let root_id = compact(root_id);
        let graph = graph_run::Entity::find_by_id(&root_id)
            .one(&self.database)
            .await?
            .ok_or_else(|| {
                GraphRunServiceError::new(
                    GraphRunServiceErrorCode::CampaignChanged,
                    "graph_run_not_found",
                    "Graph Run was not found.",
                )
            })?;
        let mode = parse_mode(&graph.execution_mode).ok_or_else(|| {
            GraphRunServiceError::new(
                GraphRunServiceErrorCode::CampaignChanged,
                "graph_run_mode_invalid",
                "Graph Run execution mode is invalid.",
            )
        })?;
        let policy_json = graph.launch_configuration.as_deref().ok_or_else(|| {
            GraphRunServiceError::new(
                GraphRunServiceErrorCode::LaunchPolicy,
                "launch_policy_invalid",
                "Graph Run launch policy is missing.",
            )
        })?;
        let policy: StoredGraphRunPolicy = serde_json::from_str(policy_json).map_err(|error| {
            GraphRunServiceError::new(
                GraphRunServiceErrorCode::LaunchPolicy,
                "launch_policy_invalid",
                format!("Stored Graph Run launch policy is invalid: {error}"),
            )
        })?;
        let access = GraphAccess::project(&graph.project_id);
        let facts = scheduling_facts(&self.database, &root_id, &access, None).await?;
        let frontier_pending = if mode == ExecutionMode::Serial {
            serial_frontier_pending(&self.database, &root_id, &facts).await?
        } else {
            false
        };
        let terminal_reconciliation_requested = mode == ExecutionMode::Serial
            && frontier_pending
            && facts
                .iter()
                .any(|facts| facts.child.is_satisfied() && facts.has_live_work);
        let selected = automatic_candidates(&facts, mode, frontier_pending)
            .into_iter()
            .map(|facts| compact(&facts.child.id))
            .collect::<Vec<_>>();
        let mut launched = Vec::with_capacity(selected.len());
        for child_id in selected {
            let identity = ClaimGeneration::next(&self.database, &root_id, &child_id).await?;
            let claim = CampaignClaim {
                root_id: &root_id,
                child_id: &child_id,
                policy_snapshot: policy_json,
                mode,
                access: &access,
                identity: identity.clone(),
                selection: ClaimSelection::Automatic,
            };
            let prompt = compose_task_prompt(
                &self.database,
                TaskPromptSource {
                    task_id: &child_id,
                    module_id: &policy.module_id,
                    local_module_folder: policy.module_link_path.as_deref().unwrap_or_default(),
                    state_name: None,
                    workflow_prompt: &policy.prompt,
                    additional_user_input: None,
                    design_directory: None,
                },
            )
            .await?;
            let accepted = self
                .terminal_launch
                .prepare_with_participant(
                    stored_terminal_request(
                        &policy,
                        &identity,
                        &child_id,
                        &graph.project_id,
                        prompt,
                    ),
                    &claim,
                )
                .await?;
            launched.push(LaunchedChild {
                task_id: child_id,
                agent_run_id: accepted.agent_run_id.clone(),
                provider: policy.agent.clone(),
            });
            let _ = self.terminal_launch.execute_accepted(accepted).await;
        }
        Ok(GraphRunAdvanceResult {
            root_id,
            launched,
            terminal_reconciliation_requested,
        })
    }

    pub async fn reset(
        &self,
        root_id: &str,
        access: &crate::execution::graph::GraphAccess,
    ) -> Result<ResetGraphRunResult, GraphRunServiceError> {
        let _mutation = self.mutation_lock.lock().await;
        self.reset_unlocked(root_id, access).await
    }

    async fn reset_unlocked(
        &self,
        root_id: &str,
        access: &crate::execution::graph::GraphAccess,
    ) -> Result<ResetGraphRunResult, GraphRunServiceError> {
        let root_id = compact(root_id);
        let root = issue::Entity::find_by_id(&root_id)
            .one(&self.database)
            .await?
            .filter(|root| root.r#type == "task")
            .ok_or_else(|| {
                GraphRunServiceError::new(
                    GraphRunServiceErrorCode::GraphFacts,
                    "task_not_found",
                    "Dependency graph root was not found.",
                )
            })?;
        if !access.allows(&root.project_id, &root.id) {
            return Err(GraphRunServiceError::new(
                GraphRunServiceErrorCode::GraphFacts,
                "graph_unauthorized",
                "The caller is not authorized for this dependency graph.",
            ));
        }

        let transaction = self.database.begin().await?;
        let mut cleared_task_ids = launch_claim::Entity::find()
            .filter(launch_claim::Column::RootId.eq(&root_id))
            .all(&transaction)
            .await?
            .into_iter()
            .map(|claim| claim.task_id)
            .collect::<Vec<_>>();
        cleared_task_ids.sort();
        launch_claim::Entity::delete_many()
            .filter(launch_claim::Column::RootId.eq(&root_id))
            .exec(&transaction)
            .await?;
        graph_run::Entity::delete_by_id(&root_id)
            .exec(&transaction)
            .await?;
        transaction.commit().await?;
        Ok(ResetGraphRunResult {
            root_id,
            cleared_task_ids,
        })
    }

    async fn refresh_header(
        &self,
        root: &issue::Model,
        decision: &LaunchPolicyDecision,
        mode: ExecutionMode,
        policy_snapshot: &str,
    ) -> Result<graph_run::Model, GraphRunServiceError> {
        let transaction = self.database.begin().await?;
        let now = Utc::now().naive_utc();
        let existing = graph_run::Entity::find_by_id(&root.id)
            .one(&transaction)
            .await?;
        let model = if let Some(existing) = existing {
            graph_run::ActiveModel {
                root_id: Set(existing.root_id),
                project_id: Set(root.project_id.clone()),
                module_id: Set(root.module_id.clone()),
                agent: Set(Some(decision.provider.clone())),
                execution_mode: Set(mode_name(mode).to_owned()),
                launch_configuration: Set(Some(policy_snapshot.to_owned())),
                created_at: Set(existing.created_at),
                updated_at: Set(now),
            }
            .update(&transaction)
            .await?
        } else {
            graph_run::ActiveModel {
                root_id: Set(root.id.clone()),
                project_id: Set(root.project_id.clone()),
                module_id: Set(root.module_id.clone()),
                agent: Set(Some(decision.provider.clone())),
                execution_mode: Set(mode_name(mode).to_owned()),
                launch_configuration: Set(Some(policy_snapshot.to_owned())),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&transaction)
            .await?
        };
        transaction.commit().await?;
        Ok(model)
    }

    async fn require_header(
        &self,
        root_id: &str,
        should_exist: bool,
    ) -> Result<Option<graph_run::Model>, GraphRunServiceError> {
        let existing = graph_run::Entity::find_by_id(compact(root_id))
            .one(&self.database)
            .await?;
        if should_exist && existing.is_none() {
            return Err(GraphRunServiceError::new(
                GraphRunServiceErrorCode::CampaignChanged,
                "graph_run_not_found",
                "Graph Run was not found.",
            ));
        }
        if !should_exist && existing.is_some() {
            return Err(GraphRunServiceError::new(
                GraphRunServiceErrorCode::CampaignChanged,
                "graph_run_already_exists",
                "Graph Run already exists.",
            ));
        }
        Ok(existing)
    }

    fn require_mutations_open(&self) -> Result<(), GraphRunServiceError> {
        if !self.guarded || PRODUCTION_MUTATIONS_OPEN.load(Ordering::Acquire) {
            return Ok(());
        }
        Err(GraphRunServiceError::new(
            GraphRunServiceErrorCode::CampaignChanged,
            "execution_reconciliation_unavailable",
            "Execution reconciliation is not ready.",
        ))
    }
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

fn stored_terminal_request(
    policy: &StoredGraphRunPolicy,
    identity: &ClaimGeneration,
    child_id: &str,
    project_id: &str,
    prompt: String,
) -> CreateTerminalSession {
    CreateTerminalSession {
        client_request_id: identity.request_id.clone(),
        project_id: project_id.to_owned(),
        issue_id: child_id.to_owned(),
        module_id: policy.module_id.clone(),
        target_id: child_id.to_owned(),
        kind: TerminalLaunchKind::Automation,
        provider: Some(policy.agent.clone()),
        model: policy.model.clone(),
        reasoning: policy.reasoning.clone(),
        policy_reference: Some(policy.policy_identity.clone()),
        prompt: Some(prompt),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: policy.required_skills.clone(),
        working_directory_identity: format!("task:{}", compact(child_id)),
        design_directory_identity: None,
        document_relative_path: None,
        columns: 120,
        rows: 32,
    }
}

fn mode_name(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Parallel => "parallel",
        ExecutionMode::Serial => "serial",
    }
}

fn parse_mode(value: &str) -> Option<ExecutionMode> {
    match value {
        "parallel" => Some(ExecutionMode::Parallel),
        "serial" => Some(ExecutionMode::Serial),
        _ => None,
    }
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
