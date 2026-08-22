use std::path::Path;

use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use crate::execution_graph::GraphAccess;
use crate::graph_run_service::{GraphRunRequest, GraphRunService};
use crate::run_now::{RunNowCaller, RunNowRequest, RunNowService};
use crate::terminal_cleanup::TerminalCleanupService;
use crate::terminal_launch::TerminalLaunchService;
use crate::work_management::commands::{
    attachments, status_facts::WorkFactRecorder, work_items, workflow, CommandError,
};
use crate::work_management::launch_policy::{
    self, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

use super::{
    backend_port::RunPrincipal,
    dependency_tools, projection, run_termination, scope,
    workflow_tools::{self, optional_string, string},
};

/// The MCP transport publishes through the same durable outbox as the GraphQL
/// surface. It composes its own recorder over its own connection: the committed
/// outbox row is the ordering authority, so a wake-up that does not reach the
/// other publisher's subscribers delays delivery to the next reread rather than
/// losing the fact.
pub(super) async fn work_facts(database: &DatabaseConnection) -> Option<WorkFactRecorder> {
    crate::runs_persistence::outbox_adopted(database)
        .await
        .then(|| {
            WorkFactRecorder::new(
                crate::runs_persistence::RunsServices::new(database.clone())
                    .outbox()
                    .events()
                    .clone(),
            )
        })
}

pub struct DispatchOutput {
    pub value: Value,
    pub wrap_result: bool,
}

impl DispatchOutput {
    pub(super) fn direct(value: Value) -> Self {
        Self {
            value,
            wrap_result: false,
        }
    }

    fn result(value: Value) -> Self {
        Self {
            value,
            wrap_result: true,
        }
    }
}

pub async fn dispatch(
    database: &DatabaseConnection,
    storage: &attachments::AttachmentStorage,
    launch_policy: &LaunchPolicyResolver,
    graph_runs: Option<&GraphRunService>,
    terminal_cleanup: &TerminalCleanupService,
    terminal_launch: Option<&TerminalLaunchService>,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> DispatchOutput {
    match dispatch_checked(
        database,
        storage,
        launch_policy,
        graph_runs,
        terminal_cleanup,
        terminal_launch,
        principal,
        name,
        arguments,
    )
    .await
    {
        Ok(output) => output,
        Err(error) => DispatchOutput::direct(workflow_tools::rejection(&error)),
    }
}

async fn dispatch_checked(
    database: &DatabaseConnection,
    storage: &attachments::AttachmentStorage,
    launch_policy: &LaunchPolicyResolver,
    graph_runs: Option<&GraphRunService>,
    terminal_cleanup: &TerminalCleanupService,
    terminal_launch: Option<&TerminalLaunchService>,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    if name == "terminate_current_run" {
        return Ok(DispatchOutput::direct(
            run_termination::terminate_current_run(terminal_cleanup, principal).await,
        ));
    }
    if name.starts_with("add_issue_type_workflow_")
        || name.starts_with("remove_issue_type_workflow_")
        || name.starts_with("set_issue_type_workflow_")
        || name.starts_with("upsert_issue_type_workflow_")
        || name.starts_with("clear_issue_type_workflow_")
    {
        scope::issue_type(database, principal, string(arguments, "type_id")?).await?;
        return workflow_tools::dispatch(database, name, arguments)
            .await
            .map(DispatchOutput::direct);
    }
    match name {
        "list_projects" => {
            let rows = projection::list_projects(database).await;
            let scoped = rows
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|row| row["id"] == principal.project_id)
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
            Ok(DispatchOutput::direct(
                projection::dependency_graph(database, &task).await,
            ))
        }
        "get_issue_type_workflow_settings" => {
            let type_id = string(arguments, "type_id")?;
            scope::issue_type(database, principal, type_id).await?;
            Ok(DispatchOutput::direct(
                projection::workflow_settings(database, type_id).await,
            ))
        }
        "create_task" => create_task(database, principal, arguments, None).await,
        "create_sub_task" => {
            let parent = string(arguments, "parent_id")?;
            create_task(database, principal, arguments, Some(parent)).await
        }
        "create_review_finding" => create_review_finding(database, principal, arguments).await,
        "update_task" => update_task(database, principal, arguments).await,
        "append_task_description" => append_description(database, principal, arguments).await,
        "update_task_status" => update_status(database, principal, arguments).await,
        "set_task_blockers" | "add_task_blocker" | "add_task_dependent" | "reparent_tasks" => {
            dependency_tools::dispatch(database, principal, name, arguments).await
        }
        "attach_file" => attach_file(database, storage, principal, arguments).await,
        "run_now" => {
            let id_or_key = string(arguments, "id_or_key")?.to_owned();
            let Some(terminal_launch) = terminal_launch else {
                return Ok(DispatchOutput::direct(json!({
                    "target_id": id_or_key,
                    "committed_state": null,
                    "run": null,
                    "detail": "Run Now is unavailable.",
                    "code": "run_now_unavailable",
                    "remedy": "Retry after terminal services recover.",
                })));
            };
            let service = RunNowService::new(
                database.clone(),
                launch_policy.clone(),
                terminal_launch.clone(),
                work_facts(database).await,
            );
            let result = service
                .execute(RunNowRequest {
                    request_identity: format!("mcp:{}:{}", principal.agent_run_id, id_or_key),
                    id_or_key,
                    caller: RunNowCaller::Agent {
                        authenticated_run_id: principal.agent_run_id.clone(),
                    },
                })
                .await;
            Ok(DispatchOutput::direct(
                match result {
                    Ok(success) => serde_json::to_value(success),
                    Err(refusal) => serde_json::to_value(refusal),
                }
                .map_err(|error| CommandError::Storage(error.to_string()))?,
            ))
        }
        "execute_dependency_graph" => {
            let task = scope::task(database, principal, string(arguments, "root_task_id")?).await?;
            let Some(graph_runs) = graph_runs else {
                return Ok(DispatchOutput::direct(json!({
                    "root_id": task.id,
                    "error": "execution_reconciliation_unavailable",
                })));
            };
            let access = GraphAccess::caller_roots(&principal.project_id, [&task.id]);
            let request = graph_run_request(&task.id, access, arguments);
            let result = if reset_requested(arguments) {
                graph_runs.reset_and_execute(request).await
            } else {
                graph_runs.execute(request).await
            };
            match result {
                Ok(result) => Ok(DispatchOutput::direct(graph_run_success(&task.id, result))),
                Err(error) => Ok(DispatchOutput::direct(graph_run_error(&task.id, &error))),
            }
        }
        "launch_default_coding_agent" => {
            let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
            let decision = match launch_policy
                .resolve(LaunchPolicyRequest {
                    task_id: task.id.clone(),
                    destination_state_id: None,
                    provider_override: None,
                    caller_scope: CallerScope::Interactive,
                    idempotency_key: uuid::Uuid::new_v4().simple().to_string(),
                })
                .await
            {
                Ok(decision) => {
                    launch_policy::record(database, &decision)
                        .await
                        .map_err(|error| CommandError::Rejected {
                            message: error.to_string(),
                            code: error.code(),
                            field: None,
                        })?
                }
                Err(error) => {
                    return Ok(DispatchOutput::direct(json!({
                        "target_id": task.id,
                        "error": error.code(),
                    })))
                }
            };
            let result =
                super::service::execute_launch_decision(database, terminal_launch, &decision).await;
            if let Ok(session) = result {
                return Ok(DispatchOutput::direct(json!({
                    "target_id": task.id,
                    "agent": session.agent,
                    "agent_run_id": session.agent_run_id,
                })));
            }
            Ok(DispatchOutput::direct(json!({
                "target_id": task.id,
                "error": "terminal_launch_unavailable",
            })))
        }
        _ => Err(CommandError::validation("Unknown WorkTracker MCP tool.")),
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

async fn create_task(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
    parent: Option<&str>,
) -> Result<DispatchOutput, CommandError> {
    let project = scope::project(database, principal, string(arguments, "project_id")?).await?;
    let kind = projection::resolve_issue_type(database, &project, string(arguments, "issue_type")?)
        .await
        .ok_or_else(|| CommandError::field("issue_type", "Unknown task issue type."))?;
    let state_id = match optional_string(arguments, "state_name") {
        Some(name) => Some(
            projection::resolve_state(database, &project, name)
                .await
                .ok_or_else(|| CommandError::field("state_name", "Unknown workflow state."))?
                .id,
        ),
        None => None,
    };
    let parent_id = parent.or_else(|| optional_string(arguments, "module_id"));
    if let Some(parent_id) = parent_id {
        scope::task_or_module_id(database, principal, parent_id).await?;
    }
    let id = work_items::create(
        database,
        work_items::CreateWorkItem {
            project_id: project,
            name: string(arguments, "name")?.to_owned(),
            issue_type_id: kind.id,
            description: optional_string(arguments, "description").map(str::to_owned),
            state_id,
            parent_id: parent_id.map(str::to_owned),
        },
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(DispatchOutput::result(Value::String(hyphenate(&id))))
}

async fn update_task(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
    let name = optional_string(arguments, "name").map(str::to_owned);
    let description = optional_string(arguments, "description").map(str::to_owned);
    let mut fields = Vec::new();
    if name.is_some() {
        fields.push("name");
    }
    if description.is_some() {
        fields.push("description");
    }
    work_items::update(
        database,
        work_items::UpdateWorkItem {
            id: task.id.clone(),
            name,
            description,
            issue_type_id: None,
        },
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(DispatchOutput::direct(
        json!({"ok": true, "task_id": task.id, "key": task.key, "updated_fields": fields}),
    ))
}

async fn append_description(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    scope::project(database, principal, string(arguments, "project_id")?).await?;
    let task = scope::task(database, principal, string(arguments, "task_id")?).await?;
    work_items::append_description(
        database,
        work_items::AppendDescription {
            id: task.id,
            new_content: string(arguments, "new_content")?.to_owned(),
        },
    )
    .await?;
    Ok(DispatchOutput::result(Value::Bool(true)))
}

async fn update_status(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let project = scope::project(database, principal, string(arguments, "project_id")?).await?;
    let task = scope::task(database, principal, string(arguments, "task_id")?).await?;
    let status_name = string(arguments, "status_name")?;
    let Some(state) = projection::resolve_state(database, &project, status_name).await else {
        return Ok(DispatchOutput::direct(
            json!({"ok": false, "task_id": task.id, "error": format!("Unknown workflow state {status_name:?}.")}),
        ));
    };
    match workflow::transition(
        database,
        workflow::TransitionWorkItem {
            id: task.id.clone(),
            target_state_id: state.id,
            origin: workflow::TransitionOrigin::Agent,
        },
        work_facts(database).await.as_ref(),
    )
    .await
    {
        Ok(_) => Ok(DispatchOutput::direct(
            json!({"ok": true, "task_id": task.id, "status": status_name}),
        )),
        Err(error) => {
            let mut body = workflow_tools::rejection(&error);
            body["task_id"] = Value::String(task.id);
            Ok(DispatchOutput::direct(body))
        }
    }
}

async fn attach_file(
    database: &DatabaseConnection,
    storage: &attachments::AttachmentStorage,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    scope::project(database, principal, string(arguments, "project_id")?).await?;
    let task = scope::task(database, principal, string(arguments, "task_id")?).await?;
    let path = Path::new(string(arguments, "file_path")?);
    if !path.is_file() {
        return Ok(DispatchOutput::direct(
            json!({"success": false, "message": "File not found", "data": null}),
        ));
    }
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_owned();
    let content = std::fs::read(path)
        .map_err(|_| CommandError::Storage("Could not read attachment file.".to_owned()))?;
    let row = attachments::create(
        database,
        storage,
        attachments::CreateAttachment {
            issue_id: task.id,
            filename,
            mime_type: Some("application/octet-stream".to_owned()),
            content,
        },
    )
    .await?;
    Ok(DispatchOutput::direct(
        json!({"success": true, "message": "Attached", "data": {"asset_id": hyphenate(&row.id)}}),
    ))
}

async fn create_review_finding(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let project = scope::project(database, principal, string(arguments, "project_id")?).await?;
    let parent = scope::task(database, principal, string(arguments, "parent_id")?).await?;
    let id = work_items::create_review_finding(
        database,
        work_items::CreateReviewFinding {
            project_id: project,
            parent_id: parent.id,
            name: string(arguments, "name")?.to_owned(),
            path: string(arguments, "path")?.to_owned(),
            line_start: arguments
                .get("line_start")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            line_end: arguments
                .get("line_end")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            note: optional_string(arguments, "note").map(str::to_owned),
        },
    )
    .await?;
    let created = projection::resolve_task(database, &id)
        .await
        .ok_or_else(|| CommandError::NotFound("Created finding not found.".to_owned()))?;
    Ok(DispatchOutput::direct(
        json!({"ok": true, "task_id": created.id, "key": created.key}),
    ))
}

fn hyphenate(value: &str) -> String {
    if value.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &value[..8],
            &value[8..12],
            &value[12..16],
            &value[16..20],
            &value[20..]
        )
    } else {
        value.to_owned()
    }
}

fn public_id(value: &str) -> String {
    hyphenate(value)
}

fn graph_run_request(
    root_id: &str,
    access: GraphAccess,
    arguments: &Map<String, Value>,
) -> GraphRunRequest {
    GraphRunRequest {
        root_id: root_id.to_owned(),
        access,
        mode: None,
        provider_override: optional_string(arguments, "agent")
            .map(str::trim)
            .filter(|agent| !agent.is_empty())
            .map(str::to_owned),
    }
}

fn reset_requested(arguments: &Map<String, Value>) -> bool {
    arguments
        .get("reset")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn graph_run_success(root_id: &str, result: crate::graph_run_service::GraphRunResult) -> Value {
    json!({
        "root_id": root_id,
        "launched": result
            .launched
            .into_iter()
            .map(|child| public_id(&child.task_id))
            .collect::<Vec<_>>(),
    })
}

fn graph_run_error(root_id: &str, error: &crate::graph_run_service::GraphRunServiceError) -> Value {
    json!({"root_id": root_id, "error": error.code_str()})
}

#[cfg(test)]
mod graph_run_contract_tests {
    use chrono::NaiveDateTime;

    use super::*;
    use crate::entities::execution::graph_run;
    use crate::graph_run_service::{GraphRunResult, LaunchedChild};

    #[test]
    fn execution_request_keeps_parallel_default_provider_override_and_reset_meaning() {
        let arguments = Map::from_iter([
            ("agent".to_owned(), json!(" claude ")),
            ("reset".to_owned(), json!(true)),
        ]);
        let access = GraphAccess::caller_roots("project", ["root"]);

        assert_eq!(
            graph_run_request("root", access.clone(), &arguments),
            GraphRunRequest {
                root_id: "root".to_owned(),
                access,
                mode: None,
                provider_override: Some("claude".to_owned()),
            }
        );
        assert!(reset_requested(&arguments));
        assert_eq!(
            graph_run_request("root", GraphAccess::project("project"), &Map::new())
                .provider_override,
            None
        );
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
