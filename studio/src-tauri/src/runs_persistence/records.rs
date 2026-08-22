#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRunRecord {
    pub id: String,
    pub issue_id: String,
    pub ticket_seq: Option<i32>,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    pub cwd: Option<String>,
    pub provider_session_id: Option<String>,
    pub lifecycle_state: Option<String>,
    pub lifecycle_updated_at: Option<String>,
    pub design_dir: Option<String>,
    pub resumed_from: Option<String>,
    pub scope: String,
    pub launch_state: Option<String>,
    pub launch_model: Option<String>,
}

/// Scope-safe public projection. Persistence-only paths, prompts, errors, and
/// command material cannot cross this boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct AgentRunHolding {
    pub agent_run_id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    pub module_id: String,
    pub agent: Option<String>,
    pub scope: String,
    pub launch_state: Option<String>,
    pub launch_model: Option<String>,
    pub started_at: String,
    pub state: String,
    pub effective_state: String,
    pub updated_at: String,
    pub provider_session_id: Option<String>,
    pub output_sequence: i64,
    pub last_output_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AutomationAttemptRecord {
    pub id: String,
    pub transition_id: String,
    pub issue_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub workflow_revision: i32,
    pub status: String,
    pub agent: Option<String>,
    pub agent_run_id: Option<String>,
    pub error: Option<String>,
    pub error_details: Option<String>,
    pub retryable: bool,
    pub dismissed_at: Option<String>,
    pub retry_of_id: Option<String>,
    pub root_attempt_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Public, lineage-shaped attempt record consumed by Studio and supported
/// callers. Database UUIDs are formatted at this boundary and typed failure
/// details remain JSON rather than being flattened into transient strings.
#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct AutomationAttemptProjection {
    pub attempt_id: String,
    pub root_attempt_id: String,
    pub retry_of_attempt_id: Option<String>,
    pub work_item_id: String,
    pub status: String,
    pub error: Option<String>,
    pub failure: Option<AttemptFailure>,
    pub retryable: bool,
    pub agent_run_id: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AttemptFailure(pub serde_json::Value);

impl CustomOutputType for AttemptFailure {
    fn gql_output_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::named_nn("Json")
    }

    fn gql_field_value(self, _ctx: &'static BuilderContext) -> Option<FieldValue<'static>> {
        seaography::async_graphql::Value::from_json(self.0)
            .ok()
            .map(FieldValue::value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionOccurrence {
    pub occurrence_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub workflow_revision: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AttemptOutcome {
    Succeeded {
        agent: String,
        agent_run_id: String,
    },
    Failed {
        error: String,
        failure: serde_json::Value,
        retryable: bool,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StatusEventRecord {
    pub cursor: i64,
    pub event_id: String,
    pub project_id: String,
    pub event_kind: String,
    pub payload_version: i32,
    pub subject_kind: String,
    pub subject_id: String,
    pub agent_run_id: Option<String>,
    pub automation_attempt_id: Option<String>,
    pub work_item_id: Option<String>,
    pub payload: String,
    pub committed_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchEffectRecord {
    pub effect_id: String,
    pub agent_run_id: String,
    pub automation_attempt_id: Option<String>,
    pub request_id: String,
    pub project_id: String,
    pub issue_id: String,
    pub scope: String,
    pub provider: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    pub policy_reference: Option<String>,
    pub state: String,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub attempt_count: i32,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub runtime_evidence: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub applied_at: Option<String>,
}
use seaography::{
    async_graphql::dynamic::{FieldValue, TypeRef},
    BuilderContext, CustomOutputType,
};
use serde::Serialize;
