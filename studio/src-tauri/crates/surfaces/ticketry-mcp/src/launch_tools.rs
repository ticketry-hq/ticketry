use super::{
    dispatch::DispatchOutput,
    public_id::public_id,
    scope,
    work_facts::work_facts,
    workflow_tools::{optional_string, string},
    RunPrincipal,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};
use ticketry_agent_execution::graph::GraphAccess;
use ticketry_agent_execution::run_now::{RunNowCaller, RunNowRequest, RunNowService};
use ticketry_agent_execution::{
    GraphRunRequest, GraphRunResult, GraphRunService, GraphRunServiceError,
};
use ticketry_terminal::{TerminalCleanupService, TerminalLaunchService};
use ticketry_work_management::commands::CommandError;
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

pub(super) async fn dispatch(
    database: &DatabaseConnection,
    launch_policy: &LaunchPolicyResolver,
    graph_runs: Option<&GraphRunService>,
    terminal_cleanup: &TerminalCleanupService,
    terminal_launch: Option<&TerminalLaunchService>,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    match name {
        "run_now" => {
            let id_or_key = string(arguments, "id_or_key")?.to_owned();
            let Some(terminal_launch) = terminal_launch else {
                return Ok(DispatchOutput::direct(json!({
                    "target_id": id_or_key,
                    "committed_state": null,
                    "committed_issue_type": null,
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
            let access = GraphAccess::caller_roots(&task.project_id, [&task.id]);
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
                    handoff: false,
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
            let result = super::service::execute_launch_decision(
                database,
                terminal_launch,
                terminal_cleanup,
                &decision,
            )
            .await;
            match result {
                Ok(session) => Ok(DispatchOutput::direct(json!({
                    "target_id": task.id,
                    "agent": session.agent,
                    "agent_run_id": session.agent_run_id,
                }))),
                Err(error) => Ok(DispatchOutput::direct(json!({
                    "target_id": task.id,
                    "error": error,
                }))),
            }
        }
        _ => Err(CommandError::validation("Unknown WorkTracker launch tool.")),
    }
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
