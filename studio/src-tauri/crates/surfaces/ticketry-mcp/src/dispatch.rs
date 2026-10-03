use super::{
    attachment_tools, codex_thread_rename, dependency_tools, launch_tools, read_tools,
    run_termination, scope, sprint_tools, work_item_tools,
    workflow_tools::{self, string},
    RunPrincipal,
};
use sea_orm::DatabaseConnection;
use serde_json::{Map, Value};
use ticketry_agent_execution::GraphRunService;
use ticketry_terminal::{TerminalCleanupService, TerminalLaunchService};
use ticketry_work_management::commands::{attachments, CommandError};
use ticketry_work_management::launch_policy::LaunchPolicyResolver;

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

    pub(super) fn result(value: Value) -> Self {
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
    codex_titles: Option<&ticketry_terminal::InstantRunTicketTitleService>,
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
        codex_titles,
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
    codex_titles: Option<&ticketry_terminal::InstantRunTicketTitleService>,
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
        "get_sprint_goals" => sprint_tools::get_sprint_goals(database, principal, arguments).await,
        "suggest_sprint_story" => {
            sprint_tools::suggest_sprint_story(database, principal, arguments).await
        }
        "list_projects"
        | "list_modules"
        | "list_issue_types"
        | "list_tasks"
        | "get_task_details"
        | "get_task_scope_context"
        | "get_dependency_graph"
        | "get_issue_type_workflow_settings" => {
            read_tools::dispatch(database, principal, name, arguments).await
        }
        "create_task"
        | "create_sub_task"
        | "create_review_finding"
        | "add_task_tags"
        | "update_task"
        | "append_task_description"
        | "update_task_status" => {
            work_item_tools::dispatch(database, principal, name, arguments).await
        }
        "set_task_blockers" | "add_task_blocker" | "add_task_dependent" | "reparent_tasks" => {
            dependency_tools::dispatch(database, principal, name, arguments).await
        }
        "attach_file" => {
            attachment_tools::attach_file(database, storage, principal, arguments).await
        }
        "run_now" | "execute_dependency_graph" | "launch_default_coding_agent" => {
            launch_tools::dispatch(
                database,
                launch_policy,
                graph_runs,
                terminal_cleanup,
                terminal_launch,
                principal,
                name,
                arguments,
            )
            .await
        }
        // Codex owns thread names outside every Ticketry table, so this write
        // has no database scope to resolve; the authenticated tool grant is the
        // whole authorization boundary.
        "rename_codex_thread" => Ok(DispatchOutput::direct(
            codex_thread_rename::rename(codex_titles, arguments).await,
        )),
        _ => Err(CommandError::validation("Unknown WorkTracker MCP tool.")),
    }
}
