use super::{
    dispatch::DispatchOutput,
    projection, scope,
    workflow_tools::{optional_string, string},
    RunPrincipal,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};
use ticketry_agent_execution::graph::GraphAccess;
use ticketry_work_management::commands::CommandError;

pub(super) async fn dispatch(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    match name {
        "list_projects" => {
            let rows = projection::list_projects(database).await;
            let scoped = rows
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|row| principal.is_global() || row["id"] == principal.project_id)
                .collect();
            Ok(DispatchOutput::result(Value::Array(scoped)))
        }
        "list_modules" => {
            let project =
                scope::project(database, principal, string(arguments, "project_id")?).await?;
            Ok(DispatchOutput::result(
                projection::list_modules(database, &project).await,
            ))
        }
        "list_issue_types" => {
            let project =
                scope::project(database, principal, string(arguments, "project_id")?).await?;
            Ok(DispatchOutput::result(
                projection::list_issue_types(database, &project).await,
            ))
        }
        "list_tasks" => list_tasks(database, principal, arguments).await,
        "get_task_details" => {
            let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
            Ok(DispatchOutput::result(
                projection::task_details(database, &task).await,
            ))
        }
        "get_task_scope_context" => {
            let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
            Ok(DispatchOutput::result(
                projection::scope_context(database, &task).await,
            ))
        }
        "get_dependency_graph" => {
            let task = scope::task(database, principal, string(arguments, "root_task_id")?).await?;
            // One factual read serves every caller. Execution owns the rule
            // that the plan is the non-archived subtree and that only blocker
            // edges inside it are returned; MCP must not restate it.
            let access = GraphAccess::caller_roots(&task.project_id, [&task.id]);
            Ok(DispatchOutput::direct(
                match ticketry_agent_execution::graph::dependency_graph(database, &task.id, &access)
                    .await
                {
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
            ))
        }
        "get_issue_type_workflow_settings" => {
            let type_id = string(arguments, "type_id")?;
            scope::issue_type(database, principal, type_id).await?;
            Ok(DispatchOutput::direct(
                projection::workflow_settings(database, type_id).await,
            ))
        }
        _ => Err(CommandError::validation("Unknown WorkTracker read tool.")),
    }
}

async fn list_tasks(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let project = scope::project(database, principal, string(arguments, "project_id")?).await?;
    let state = match optional_string(arguments, "state_name") {
        Some(name) => match projection::resolve_state(database, &project, name).await {
            Some(row) => Some(row.id),
            None => return Ok(DispatchOutput::result(Value::Array(Vec::new()))),
        },
        None => None,
    };
    let module = match optional_string(arguments, "module_id") {
        Some(value) => Some(scope::module_id(database, principal, value).await?),
        None => None,
    };
    Ok(DispatchOutput::result(
        projection::list_tasks(
            database,
            &project,
            module.as_deref(),
            state.as_deref(),
            arguments
                .get("include_description")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .await,
    ))
}
