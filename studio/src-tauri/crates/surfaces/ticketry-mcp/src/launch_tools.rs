//! Agent launches: Run Now, dependency-graph execution and the default
//! coding agent. Each delegates to the existing launch policy resolver, graph
//! run service or terminal launch services; routing adds no business rule.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use ticketry_agent_execution::graph::GraphAccess;
use ticketry_agent_execution::run_now::{RunNowCaller, RunNowRequest, RunNowService};
use ticketry_agent_execution::{GraphRunRequest, GraphRunResult, GraphRunServiceError};
use ticketry_work_management::commands::CommandError;
use ticketry_work_management::launch_policy::{self, CallerScope, LaunchPolicyRequest};

use super::{
    public_id::public_id,
    scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
    work_facts::work_facts,
};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(TypedTool::new(
            "run_now",
            "Convert an eligible childless Story to an Implementation task in Implement and launch its agent with the Implementation launch settings, as one action.\n\n``id_or_key`` accepts a work-item UUID or key. The work item keeps its identity, key, content, and relationships. Rust owns refusal, destination-policy preflight, the guarded conversion, and task-scoped launch ordering. Refusals are returned as structured results; ``committed_state`` and ``committed_issue_type`` are present only when the conversion committed.",
            run_now,
        ))
        .with(TypedTool::new(
            "execute_dependency_graph",
            "Launch eligible direct children of a root task.\n\nOnly direct children participate. Each child launches once after every\nblocker reaches a satisfying workflow state; a durable ledger prevents\nlater re-launches.\n\nPassing ``reset=True`` clears that root's ledger first, then executes\nnewly launchable direct children. The default leaves the ledger intact.\n\nReturns ``root_id`` and task ids launched by this call.",
            execute_dependency_graph,
        ))
        .with(TypedTool::new(
            "launch_default_coding_agent",
            "Launch the default coding agent for one work item (#924).\n\nStarts a normal, task-scoped coding session for the target ticket: the\nprompt is built from that ticket's own context (you cannot pass prompt\ntext), and the current-state binding selects the provider. ``id_or_key`` is the\ntarget's UUID or key (e.g. ``PROJ-123``).\n\nReturns ``{\"target_id\", \"agent\", \"agent_run_id\"}`` once the run\nis durably launched — the agent then continues on its own in a detached\nterminal. On a backend rejection it returns ``{\"target_id\", \"error\"}``\ninstead of raising (unknown target, no module ancestry, no selected\nprofile). This is a single interactive launch: it starts no orchestration\nrun, dependency graph, or planning phase, and never moves the target's\nworkflow state. Repeated calls each start a fresh run.",
            launch_default_coding_agent,
        ))
}

// Field doc comments would publish as schema descriptions, so these
// parameter types keep plain comments.

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct Target {
    id_or_key: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct GraphExecution {
    root_task_id: String,
    // Trimmed; blank means no provider override.
    #[serde(default)]
    agent: Option<String>,
    // True clears the root's launch ledger first.
    #[serde(default)]
    reset: bool,
}

// Caller identity comes from the authenticated principal, never arguments.
async fn run_now(call: ToolCall, target: Target) -> Result<Value, CommandError> {
    let id_or_key = target.id_or_key;
    let principal = &call.principal;
    let Some(terminal_launch) = call.terminal_launch else {
        return Ok(json!({
            "target_id": id_or_key,
            "committed_state": null,
            "committed_issue_type": null,
            "run": null,
            "detail": "Run Now is unavailable.",
            "code": "run_now_unavailable",
            "remedy": "Retry after terminal services recover.",
        }));
    };
    let service = RunNowService::new(
        call.database.clone(),
        call.launch_policy,
        terminal_launch,
        work_facts(&call.database).await,
    );
    let result = service
        .execute(RunNowRequest {
            request_identity: if principal.is_global() {
                format!("mcp:global:{id_or_key}")
            } else {
                format!("mcp:{}:{}", principal.agent_run_id, id_or_key)
            },
            id_or_key,
            caller: if principal.is_global() {
                RunNowCaller::Human
            } else {
                RunNowCaller::Agent {
                    authenticated_run_id: principal.agent_run_id.clone(),
                }
            },
        })
        .await;
    Ok(match result {
        Ok(success) => serde_json::to_value(success),
        Err(refusal) => serde_json::to_value(refusal),
    }
    .map_err(|error| CommandError::Storage(error.to_string()))?)
}

async fn execute_dependency_graph(
    call: ToolCall,
    execution: GraphExecution,
) -> Result<Value, CommandError> {
    let task = scope::task(&call.database, &call.principal, &execution.root_task_id).await?;
    let Some(graph_runs) = call.graph_runs else {
        return Ok(json!({
            "root_id": task.id,
            "error": "execution_reconciliation_unavailable",
        }));
    };
    let access = GraphAccess::caller_roots(&task.project_id, [&task.id]);
    let reset = execution.reset;
    let request = graph_run_request(&task.id, access, execution.agent);
    let result = if reset {
        graph_runs.reset_and_execute(request).await
    } else {
        graph_runs.execute(request).await
    };
    match result {
        Ok(result) => Ok(graph_run_success(&task.id, result)),
        Err(error) => Ok(graph_run_error(&task.id, &error)),
    }
}

async fn launch_default_coding_agent(
    call: ToolCall,
    target: Target,
) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &target.id_or_key).await?;
    let decision = match call
        .launch_policy
        .resolve(LaunchPolicyRequest {
            task_id: task.id.clone(),
            destination_state_id: None,
            provider_override: None,
            caller_scope: CallerScope::Interactive,
            idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
            handoff: false,
        })
        .await
    {
        Ok(decision) => launch_policy::record(database, &decision)
            .await
            .map_err(|error| CommandError::Rejected {
                message: error.to_string(),
                code: error.code(),
                field: None,
            })?,
        Err(error) => {
            return Ok(json!({
                "target_id": task.id,
                "error": error.code(),
            }))
        }
    };
    let result = super::service::execute_launch_decision(
        database,
        call.terminal_launch.as_ref(),
        &call.terminal_cleanup,
        &decision,
    )
    .await;
    match result {
        Ok(session) => Ok(json!({
            "target_id": task.id,
            "agent": session.agent,
            "agent_run_id": session.agent_run_id,
        })),
        Err(error) => Ok(json!({
            "target_id": task.id,
            "error": error,
        })),
    }
}

fn graph_run_request(root_id: &str, access: GraphAccess, agent: Option<String>) -> GraphRunRequest {
    GraphRunRequest {
        root_id: root_id.to_owned(),
        access,
        mode: None,
        provider_override: agent
            .as_deref()
            .map(str::trim)
            .filter(|agent| !agent.is_empty())
            .map(str::to_owned),
    }
}

fn graph_run_success(root_id: &str, result: GraphRunResult) -> Value {
    json!({
        "root_id": root_id,
        "launched": result
            .launched
            .into_iter()
            .map(|child| public_id(&child.task_id))
            .collect::<Vec<_>>(),
    })
}

fn graph_run_error(root_id: &str, error: &GraphRunServiceError) -> Value {
    json!({"root_id": root_id, "error": error.code_str()})
}

#[cfg(test)]
mod graph_run_contract_tests {
    use chrono::NaiveDateTime;

    use super::*;
    use ticketry_agent_execution::LaunchedChild;
    use ticketry_entities::graph_run;

    #[test]
    fn execution_request_keeps_parallel_default_provider_override_and_reset_meaning() {
        let parse = |arguments: Value| -> GraphExecution {
            serde_json::from_value(arguments).expect("well-formed graph execution")
        };
        let access = GraphAccess::caller_roots("project", ["root"]);

        let supplied = parse(json!({"root_task_id": "root", "agent": " claude ", "reset": true}));
        assert!(supplied.reset);
        assert_eq!(
            graph_run_request("root", access.clone(), supplied.agent),
            GraphRunRequest {
                root_id: "root".to_owned(),
                access,
                mode: None,
                provider_override: Some("claude".to_owned()),
            }
        );

        for omitted in [
            json!({"root_task_id": "root"}),
            json!({"root_task_id": "root", "agent": null}),
            json!({"root_task_id": "root", "agent": "   "}),
        ] {
            let execution = parse(omitted.clone());
            assert!(!execution.reset, "{omitted}: reset defaults to false");
            assert_eq!(
                graph_run_request("root", GraphAccess::project("project"), execution.agent)
                    .provider_override,
                None,
                "{omitted}: blank or absent agent means no override"
            );
        }
    }

    #[test]
    fn execution_response_keeps_only_public_root_and_child_identities() {
        let result = GraphRunResult {
            graph_run: graph_run::Model {
                root_id: "root-private".to_owned(),
                agent: Some("private-provider".to_owned()),
                created_at: NaiveDateTime::default(),
                updated_at: NaiveDateTime::default(),
                module_id: Some("private-module".to_owned()),
                project_id: "private-project".to_owned(),
                execution_mode: "parallel".to_owned(),
                launch_configuration: Some("private-policy".to_owned()),
            },
            launched: vec![LaunchedChild {
                task_id: "10000000000000000000000000000001".to_owned(),
                agent_run_id: "private-run".to_owned(),
                provider: "private-provider".to_owned(),
            }],
        };

        assert_eq!(
            graph_run_success("public-root", result),
            json!({
                "root_id": "public-root",
                "launched": ["10000000-0000-0000-0000-000000000001"],
            })
        );
    }
}
