//! Scoped reads of projects, modules, issue types, tasks and workflow policy.

use super::{
    projection, scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
};
use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use ticketry_agent_execution::graph::GraphAccess;
use ticketry_work_management::commands::CommandError;

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(TypedTool::new(
            "get_task_details",
            "Get detailed information about a specific task using its ID or Key (e.g. PROJ-123).",
            |call, TaskReference { id_or_key }| async move {
                let task = scope::task(&call.database, &call.principal, &id_or_key).await?;
                Ok(projection::task_details(&call.database, &task).await)
            },
        ).answers_under_result())
        .with(TypedTool::without_parameters(
            "list_projects",
            "List all projects in the worktracker.",
            list_projects,
        ).answers_under_result())
        .with(TypedTool::new(
            "list_modules",
            "List a project's modules (issues of level ``module``, e.g. Epics).",
            |call, ProjectReference { project_id }| async move {
                let project = scope::project(&call.database, &call.principal, &project_id).await?;
                Ok(projection::list_modules(&call.database, &project).await)
            },
        ).answers_under_result())
        .with(TypedTool::new(
            "list_issue_types",
            "List a project's configurable issue types.\n\nEach row carries its ``level`` bucket (``module`` vs ``task``). Use it\nto map a selected type name to the id the create tools require.",
            |call, ProjectReference { project_id }| async move {
                let project = scope::project(&call.database, &call.principal, &project_id).await?;
                Ok(projection::list_issue_types(&call.database, &project).await)
            },
        ).answers_under_result())
        .with(TypedTool::new(
            "list_tasks",
            "List tasks (work items) in a project, optionally filtered by module or state.",
            list_tasks,
        ).answers_under_result())
        .with(TypedTool::new(
            "get_task_scope_context",
            "Read a task's dependency slice: which tasks it depends on, which\ndepend on it, which are owned elsewhere, plus an advisory summary.\nID may be a UUID or a key (e.g. PROJ-123). Read-only.",
            |call, TaskReference { id_or_key }| async move {
                let task = scope::task(&call.database, &call.principal, &id_or_key).await?;
                Ok(projection::scope_context(&call.database, &task).await)
            },
        ).answers_under_result())
        .with(TypedTool::new(
            "get_dependency_graph",
            "Read a task subtree's workflow states and dependency edges.\n\nReturns the root plus factual nodes carrying ``id``, workflow-state\n``state``, ``parent_id``, and ``blocked_by`` ids. This read never\nlaunches agents and does not depend on an execution run.",
            dependency_graph,
        ))
        .with(TypedTool::new(
            "get_issue_type_workflow_settings",
            "Read one issue type's live workflow policy.\n\nReturns its start state, revision-guarded transition map with agent\npermissions, launch bindings with auto-start, and standing warnings.",
            |call, IssueTypeReference { type_id }| async move {
                scope::issue_type(&call.database, &call.principal, &type_id).await?;
                Ok(projection::workflow_settings(&call.database, &type_id).await)
            },
        ))
}

// Field doc comments would publish as schema descriptions, so these
// parameter types keep plain comments.

/// One work item, named by UUID or key.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TaskReference {
    id_or_key: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct ProjectReference {
    project_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct IssueTypeReference {
    type_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct DependencyGraphRoot {
    root_task_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TaskListing {
    project_id: String,
    #[serde(default)]
    module_id: Option<String>,
    #[serde(default)]
    state_name: Option<String>,
    #[serde(default)]
    include_description: bool,
}

async fn list_projects(call: ToolCall) -> Result<Value, CommandError> {
    let rows = projection::list_projects(&call.database).await;
    let scoped = rows
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|row| call.principal.is_global() || row["id"] == call.principal.project_id)
        .collect();
    Ok(Value::Array(scoped))
}

async fn list_tasks(call: ToolCall, listing: TaskListing) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    let project = scope::project(database, principal, &listing.project_id).await?;
    let state = match listing.state_name.as_deref() {
        Some(name) => match projection::resolve_state(database, &project, name).await {
            Some(row) => Some(row.id),
            None => return Ok(Value::Array(Vec::new())),
        },
        None => None,
    };
    let module = match listing.module_id.as_deref() {
        Some(value) => Some(scope::module_id(database, principal, value).await?),
        None => None,
    };
    Ok(projection::list_tasks(
        database,
        &project,
        module.as_deref(),
        state.as_deref(),
        listing.include_description,
    )
    .await)
}

async fn dependency_graph(
    call: ToolCall,
    DependencyGraphRoot { root_task_id }: DependencyGraphRoot,
) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &root_task_id).await?;
    // One factual read serves every caller. Execution owns the rule that the
    // plan is the non-archived subtree and that only blocker edges inside it
    // are returned; MCP must not restate it.
    let access = GraphAccess::caller_roots(&task.project_id, [&task.id]);
    Ok(
        match ticketry_agent_execution::graph::dependency_graph(database, &task.id, &access).await {
            Ok(graph) => json!({
                "root_id": graph.root_id,
                "nodes": graph
                    .nodes
                    .into_iter()
                    .map(|node| json!({
                        "id": node.id,
                        "state": node.state,
                        "parent_id": node.parent_id,
                        "blocked_by": node.blocked_by,
                    }))
                    .collect::<Vec<_>>(),
            }),
            Err(error) => json!({"root_id": task.id, "error": error.code().as_str()}),
        },
    )
}
