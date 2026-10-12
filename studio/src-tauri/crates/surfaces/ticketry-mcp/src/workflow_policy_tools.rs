//! Issue-type workflow-policy writes: transitions, start state, auto-start and
//! launch bindings. Every tool resolves its issue type through one shared
//! scope step before writing, and each write delegates to one revision-guarded
//! workflow or catalog command; routing adds no business rule.

mod launch_binding_upsert;

use std::future::Future;

use rmcp::schemars::{self, JsonSchema};
use sea_orm::DatabaseConnection;
use serde::{de::DeserializeOwned, Deserialize, Deserializer};
use ticketry_work_management::commands::{catalog, workflow, CommandError};

use super::{
    projection, scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
};

#[cfg(test)]
pub(crate) use launch_binding_upsert::ensure_profile_supported;

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(policy_tool(
            "add_issue_type_workflow_transition",
            "Add one transition to a type's workflow at the supplied revision.",
            add_transition,
        ))
        .with(policy_tool(
            "remove_issue_type_workflow_transition",
            "Remove one transition from a type's workflow at the supplied revision.",
            remove_transition,
        ))
        .with(policy_tool(
            "set_issue_type_workflow_transition_permission",
            "Update policy on one existing transition.",
            set_transition_permission,
        ))
        .with(policy_tool(
            "set_issue_type_workflow_start_state",
            "Set the issue type's start state at the supplied revision.",
            set_start_state,
        ))
        .with(policy_tool(
            "set_issue_type_workflow_auto_start",
            "Toggle auto-start; enabling requires a valid launch binding.",
            set_auto_start,
        ))
        .with(policy_tool(
            "clear_issue_type_workflow_launch_binding",
            "Delete one state's launch binding and its auto-start setting.",
            clear_launch_binding,
        ))
        .with(policy_tool(
            "upsert_issue_type_workflow_launch_binding",
            "Create or replace one state's launch binding at the supplied revision.",
            launch_binding_upsert::upsert,
        ))
}

/// Parameters that name the issue type whose workflow they write.
trait IssueTypeScoped {
    fn type_id(&self) -> &str;
}

/// A policy tool: the caller's issue-type scope is checked before `write`
/// runs, and the type's refreshed workflow settings answer every success.
fn policy_tool<P, W, F>(name: &'static str, description: &'static str, write: W) -> TypedTool
where
    P: IssueTypeScoped + DeserializeOwned + JsonSchema + Send + 'static,
    W: Fn(DatabaseConnection, P) -> F + Clone + Send + Sync + 'static,
    F: Future<Output = Result<(), CommandError>> + Send + 'static,
{
    TypedTool::new(name, description, move |call: ToolCall, parameters: P| {
        let write = write.clone();
        async move {
            let type_id = parameters.type_id().to_owned();
            scope::issue_type(&call.database, &call.principal, &type_id).await?;
            write(call.database.clone(), parameters).await?;
            Ok(projection::workflow_settings(&call.database, &type_id).await)
        }
    })
}

macro_rules! issue_type_scoped {
    ($($parameters:ty),+ $(,)?) => {
        $(impl IssueTypeScoped for $parameters {
            fn type_id(&self) -> &str {
                &self.type_id
            }
        })+
    };
}

issue_type_scoped!(
    NewTransition,
    Transition,
    TransitionPermission,
    StartState,
    AutoStart,
    LaunchBindingState,
    launch_binding_upsert::LaunchBindingUpsert,
);

// Field doc comments would publish as schema descriptions, so these
// parameter types keep plain comments. `workflow_revision` is an i32, so an
// out-of-range revision is a field rejection before any command runs.

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct NewTransition {
    type_id: String,
    from_state_id: String,
    to_state_id: String,
    workflow_revision: i32,
    #[serde(default = "agent_allowed_by_default")]
    agent_allowed: bool,
    #[serde(default)]
    handoff: bool,
}

fn agent_allowed_by_default() -> bool {
    true
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct Transition {
    type_id: String,
    from_state_id: String,
    to_state_id: String,
    workflow_revision: i32,
}

// Omitted leaves the stored permission unchanged; null is refused rather
// than read as omitted.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TransitionPermission {
    type_id: String,
    from_state_id: String,
    to_state_id: String,
    #[serde(default)]
    agent_allowed: Unchanged<bool>,
    #[serde(default)]
    handoff: Unchanged<bool>,
    workflow_revision: i32,
}

/// An optional field whose absence leaves the stored value unchanged. A
/// supplied value, `null` included, must parse as `T`, and the field publishes
/// `T`'s plain schema without a default.
#[derive(Default)]
struct Unchanged<T>(Option<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Unchanged<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(|value| Self(Some(value)))
    }
}

impl<T: JsonSchema> JsonSchema for Unchanged<T> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        T::schema_name()
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        T::json_schema(generator)
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct StartState {
    type_id: String,
    state_id: String,
    workflow_revision: i32,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct AutoStart {
    type_id: String,
    state_id: String,
    auto_start: bool,
    workflow_revision: i32,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct LaunchBindingState {
    type_id: String,
    state_id: String,
    workflow_revision: i32,
}

async fn add_transition(
    database: DatabaseConnection,
    transition: NewTransition,
) -> Result<(), CommandError> {
    workflow::create_transition(
        &database,
        workflow::NewTransition {
            issue_type_id: transition.type_id,
            from_state_id: transition.from_state_id,
            to_state_id: transition.to_state_id,
            workflow_revision: transition.workflow_revision,
            agent_allowed: transition.agent_allowed,
            handoff: transition.handoff,
        },
    )
    .await?;
    Ok(())
}

async fn remove_transition(
    database: DatabaseConnection,
    transition: Transition,
) -> Result<(), CommandError> {
    workflow::delete_transition(
        &database,
        workflow::RevisionedTransition {
            issue_type_id: transition.type_id,
            from_state_id: transition.from_state_id,
            to_state_id: transition.to_state_id,
            workflow_revision: transition.workflow_revision,
        },
    )
    .await?;
    Ok(())
}

async fn set_transition_permission(
    database: DatabaseConnection,
    permission: TransitionPermission,
) -> Result<(), CommandError> {
    workflow::update_transition(
        &database,
        workflow::TransitionPatch {
            issue_type_id: permission.type_id,
            from_state_id: permission.from_state_id,
            to_state_id: permission.to_state_id,
            agent_allowed: permission.agent_allowed.0,
            handoff: permission.handoff.0,
            workflow_revision: permission.workflow_revision,
        },
    )
    .await?;
    Ok(())
}

async fn set_start_state(
    database: DatabaseConnection,
    start: StartState,
) -> Result<(), CommandError> {
    catalog::update_issue_type(
        &database,
        catalog::UpdateIssueType {
            id: start.type_id,
            name: None,
            color: None,
            sort_order: None,
            start_state_id: Some(start.state_id),
            workflow_revision: Some(start.workflow_revision),
        },
    )
    .await?;
    Ok(())
}

async fn set_auto_start(
    database: DatabaseConnection,
    auto_start: AutoStart,
) -> Result<(), CommandError> {
    workflow::patch_launch_binding(
        &database,
        workflow::PatchLaunchBinding {
            issue_type_id: auto_start.type_id,
            state_id: auto_start.state_id,
            workflow_revision: auto_start.workflow_revision,
            prompt: workflow::PatchValue::Unset,
            required_skills: workflow::PatchValue::Unset,
            stage_skills: workflow::PatchValue::Unset,
            profile: workflow::PatchValue::Unset,
            model_id: workflow::PatchValue::Unset,
            reasoning_id: workflow::PatchValue::Unset,
            auto_start: workflow::PatchValue::Value(auto_start.auto_start),
            subtree_run_enabled: workflow::PatchValue::Unset,
        },
    )
    .await?;
    Ok(())
}

async fn clear_launch_binding(
    database: DatabaseConnection,
    state: LaunchBindingState,
) -> Result<(), CommandError> {
    workflow::delete_launch_binding(
        &database,
        workflow::RevisionedState {
            issue_type_id: state.type_id,
            state_id: state.state_id,
            workflow_revision: state.workflow_revision,
        },
    )
    .await?;
    Ok(())
}
