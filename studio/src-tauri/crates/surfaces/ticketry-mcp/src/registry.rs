use std::sync::Arc;

use rmcp::model::{JsonObject, Tool};
use serde_json::{json, Map, Value};

fn schema(properties: Value, required: &[&str]) -> Arc<JsonObject> {
    let mut object = Map::new();
    object.insert("type".to_owned(), Value::String("object".to_owned()));
    object.insert("properties".to_owned(), properties);
    if !required.is_empty() {
        object.insert("required".to_owned(), json!(required));
    }
    Arc::new(object)
}

fn tool(
    name: &'static str,
    description: &'static str,
    properties: Value,
    required: &[&str],
) -> Tool {
    Tool::new(name, description, schema(properties, required))
}

fn nullable_string() -> Value {
    json!({"anyOf": [{"type": "string"}, {"type": "null"}], "default": null})
}

fn nullable_strings() -> Value {
    json!({"anyOf": [{"items": {"type": "string"}, "type": "array"}, {"type": "null"}], "default": null})
}

pub fn tools() -> Vec<Tool> {
    vec![
        tool("mcp_ping", "Verify MCP transport and tool execution without touching a backend.", json!({}), &[]),
        tool("terminate_current_run", "Terminate only the Studio run bound to this MCP request. Ticket runs must first reach a configured destination state from their launch state.", json!({}), &[]),
        tool("add_issue_type_workflow_transition", "Add one transition to a type's workflow at the supplied revision.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"},
            "workflow_revision": {"type": "integer"}, "agent_allowed": {"type": "boolean", "default": true}
        }), &["type_id", "from_state_id", "to_state_id", "workflow_revision"]),
        tool("add_task_blocker", "Add a dependency edge: task_id is blocked by blocker_task_id.", json!({
            "task_id": {"type": "string"}, "blocker_task_id": {"type": "string"}
        }), &["task_id", "blocker_task_id"]),
        tool("add_task_dependent", "Add a reverse dependency edge: dependent_task_id depends on task_id.", json!({
            "task_id": {"type": "string"}, "dependent_task_id": {"type": "string"}
        }), &["task_id", "dependent_task_id"]),
        tool("append_task_description", "Append text to the existing description of a task.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "new_content": {"type": "string"}
        }), &["project_id", "task_id", "new_content"]),
        tool("attach_file", "Attach a local file to a task.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "file_path": {"type": "string"}
        }), &["project_id", "task_id", "file_path"]),
        tool("clear_issue_type_workflow_launch_binding", "Delete one state's launch binding and its auto-start setting.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "workflow_revision"]),
        tool("create_review_finding", "Create an Implementation finding under a Story in Review (#905).\n\nThe dedicated review-finding surface: one call creates a direct\nImplementation child, parented to a Story currently in ``Review``, born\ndirectly in the Implementation workflow's start stage, with a fixed\nevidence-block description — ``Path`` (repo-relative), inclusive\n``Lines`` (``line_start``..``line_end``), and an optional ``Note``.\n\nReturns ``{\"ok\": True, \"task_id\", \"key\"}`` on success. On rejection it\nreturns ``{\"ok\": False, ...}`` with a machine-readable reason instead of\nraising: malformed evidence locally (implausible path, or a\nnon-inclusive / non-positive line range), and — from the backend gate — a\nparent that is not a Story, a parent not in ``Review``, or a\nforeign-project parent (``detail``/``code``/``from``/``to``).\n\nInert by contract: it never launches an agent, moves the parent's state,\ntouches the scheduler, or draws a blocker/dependency edge.", json!({
            "project_id": {"type": "string"}, "parent_id": {"type": "string"}, "name": {"type": "string"},
            "path": {"type": "string"}, "line_start": {"type": "integer"}, "line_end": {"type": "integer"}, "note": nullable_string()
        }), &["project_id", "parent_id", "name", "path", "line_start", "line_end"]),
        tool("create_sub_task", "Create a sub-task with an explicit type, optionally in a named state.", json!({
            "project_id": {"type": "string"}, "parent_id": {"type": "string"}, "name": {"type": "string"},
            "issue_type": {"type": "string"}, "description": {"type": "string", "default": ""}, "state_name": nullable_string()
        }), &["project_id", "parent_id", "name", "issue_type"]),
        tool("create_task", "Create a task with an explicit type, optionally in a named state.", json!({
            "project_id": {"type": "string"}, "name": {"type": "string"}, "issue_type": {"type": "string"},
            "description": {"type": "string", "default": ""}, "module_id": nullable_string(), "state_name": nullable_string()
        }), &["project_id", "name", "issue_type"]),
        tool("execute_dependency_graph", "Launch eligible direct children of a root task.\n\nOnly direct children participate. Each child launches once after every\nblocker reaches a satisfying workflow state; a durable ledger prevents\nlater re-launches.\n\nPassing ``reset=True`` clears that root's ledger first, then executes\nnewly launchable direct children. The default leaves the ledger intact.\n\nReturns ``root_id`` and task ids launched by this call.", json!({
            "root_task_id": {"type": "string"}, "agent": nullable_string(), "reset": {"type": "boolean", "default": false}
        }), &["root_task_id"]),
        tool("get_dependency_graph", "Read a task subtree's workflow states and dependency edges.\n\nReturns the root plus factual nodes carrying ``id``, workflow-state\n``state``, ``parent_id``, and ``blocked_by`` ids. This read never\nlaunches agents and does not depend on an execution run.", json!({
            "root_task_id": {"type": "string"}
        }), &["root_task_id"]),
        tool("get_issue_type_workflow_settings", "Read one issue type's live workflow policy.\n\nReturns its start state, revision-guarded transition map with agent\npermissions, launch bindings with auto-start, and standing warnings.", json!({
            "type_id": {"type": "string"}
        }), &["type_id"]),
        tool("get_task_details", "Get detailed information about a specific task using its ID or Key (e.g. PROJ-123).", json!({
            "id_or_key": {"type": "string"}
        }), &["id_or_key"]),
        tool("get_task_scope_context", "Read a task's dependency slice: which tasks it depends on, which\ndepend on it, which are owned elsewhere, plus an advisory summary.\nID may be a UUID or a key (e.g. PROJ-123). Read-only.", json!({
            "id_or_key": {"type": "string"}
        }), &["id_or_key"]),
        tool("launch_default_coding_agent", "Launch the default coding agent for one work item (#924).\n\nStarts a normal, task-scoped coding session for the target ticket: the\nprompt is built from that ticket's own context (you cannot pass prompt\ntext), and the current-state binding selects the provider. ``id_or_key`` is the\ntarget's UUID or key (e.g. ``PROJ-123``).\n\nReturns ``{\"target_id\", \"agent\", \"agent_run_id\"}`` once the run\nis durably launched — the agent then continues on its own in a detached\nterminal. On a backend rejection it returns ``{\"target_id\", \"error\"}``\ninstead of raising (unknown target, no module ancestry, no selected\nprofile). This is a single interactive launch: it starts no orchestration\nrun, dependency graph, or planning phase, and never moves the target's\nworkflow state. Repeated calls each start a fresh run.", json!({
            "id_or_key": {"type": "string"}
        }), &["id_or_key"]),
        tool("list_issue_types", "List a project's configurable issue types.\n\nEach row carries its ``level`` bucket (``module`` vs ``task``). Use it\nto map a selected type name to the id the create tools require.", json!({
            "project_id": {"type": "string"}
        }), &["project_id"]),
        tool("list_modules", "List a project's modules (issues of level ``module``, e.g. Epics).", json!({
            "project_id": {"type": "string"}
        }), &["project_id"]),
        tool("list_projects", "List all projects in the worktracker.", json!({}), &[]),
        tool("list_tasks", "List tasks (work items) in a project, optionally filtered by module or state.", json!({
            "project_id": {"type": "string"}, "module_id": nullable_string(), "state_name": nullable_string(),
            "include_description": {"type": "boolean", "default": false}
        }), &["project_id"]),
        tool("remove_issue_type_workflow_transition", "Remove one transition from a type's workflow at the supplied revision.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "from_state_id", "to_state_id", "workflow_revision"]),
        tool("reparent_tasks", "Reparent existing work items under a parent work item.\n\nBoth parent_task_id and each entry in task_ids may be a UUID or a\nworktracker key (e.g. \"VEEVI-68\"). If module_id is omitted, the\nreparented tasks inherit the parent's module. Returns a dict with keys:\nparent_task_id, reparented, skipped, failed.", json!({
            "project_id": {"type": "string"}, "parent_task_id": {"type": "string"}, "task_ids": {"type": "array", "items": {"type": "string"}}, "module_id": nullable_string()
        }), &["project_id", "parent_task_id", "task_ids"]),
        tool("run_now", "Move an eligible Story to Implement and launch its agent as one action.\n\n``id_or_key`` accepts a work-item UUID or key. Rust owns refusal, destination-policy preflight, workflow move, and task-scoped launch ordering. Refusals are returned as structured results; a committed destination is present only when the move occurred.", json!({
            "id_or_key": {"type": "string"}
        }), &["id_or_key"]),
        tool("set_issue_type_workflow_auto_start", "Toggle auto-start; enabling requires a valid launch binding.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "auto_start": {"type": "boolean"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "auto_start", "workflow_revision"]),
        tool("set_issue_type_workflow_start_state", "Set the issue type's start state at the supplied revision.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "workflow_revision"]),
        tool("set_issue_type_workflow_transition_permission", "Allow or forbid agents on one existing transition.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"},
            "agent_allowed": {"type": "boolean"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "from_state_id", "to_state_id", "agent_allowed", "workflow_revision"]),
        tool("set_task_blockers", "Replace the tasks that block a task. IDs may be UUIDs or keys.", json!({
            "task_id": {"type": "string"}, "blocked_by_ids": {"type": "array", "items": {"type": "string"}}
        }), &["task_id", "blocked_by_ids"]),
        tool("update_task", "Replace a task's supplied title and/or full description.", json!({
            "id_or_key": {"type": "string"}, "name": nullable_string(), "description": nullable_string()
        }), &["id_or_key"]),
        tool("update_task_status", "Update the status/state of a task (e.g. 'Todo', 'Done').\n\nReturns ``{\"ok\": True, ...}`` on success, or ``{\"ok\": False, ...}`` with\nthe gate's structured reason (``detail``/``code``/``from``/``to``) when\nthe backend refuses an illegal workflow move (#872).\n\nThis tool always identifies the write as agent-origin, so the configured\ngraph and its agent permissions govern the move.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "status_name": {"type": "string"}
        }), &["project_id", "task_id", "status_name"]),
        tool("upsert_issue_type_workflow_launch_binding", "Create or replace one state's launch binding at the supplied revision.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"},
            "prompt": nullable_string(), "agent": nullable_string(), "model": nullable_string(), "reasoning": nullable_string(), "required_skills": nullable_strings()
        }), &["type_id", "state_id", "workflow_revision"]),
    ]
}

/// Every operation a launched run's grant may name.
pub fn allowed_provider_operations() -> Vec<String> {
    tools()
        .into_iter()
        .map(|tool| tool.name.into_owned())
        .chain(std::iter::once("provider_lifecycle".to_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_adds_run_now_to_the_legacy_tool_contract() {
        let tools = tools();
        assert_eq!(tools.len(), 31);
        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_ref()).collect();
        assert_eq!(
            names,
            vec![
                "mcp_ping",
                "terminate_current_run",
                "add_issue_type_workflow_transition",
                "add_task_blocker",
                "add_task_dependent",
                "append_task_description",
                "attach_file",
                "clear_issue_type_workflow_launch_binding",
                "create_review_finding",
                "create_sub_task",
                "create_task",
                "execute_dependency_graph",
                "get_dependency_graph",
                "get_issue_type_workflow_settings",
                "get_task_details",
                "get_task_scope_context",
                "launch_default_coding_agent",
                "list_issue_types",
                "list_modules",
                "list_projects",
                "list_tasks",
                "remove_issue_type_workflow_transition",
                "reparent_tasks",
                "run_now",
                "set_issue_type_workflow_auto_start",
                "set_issue_type_workflow_start_state",
                "set_issue_type_workflow_transition_permission",
                "set_task_blockers",
                "update_task",
                "update_task_status",
                "upsert_issue_type_workflow_launch_binding",
            ]
        );
        assert_eq!(
            tools
                .iter()
                .find(|tool| tool.name == "create_task")
                .unwrap()
                .input_schema["required"],
            json!(["project_id", "name", "issue_type"])
        );
        let create_task = tools
            .iter()
            .find(|tool| tool.name == "create_task")
            .unwrap();
        assert_eq!(
            create_task.input_schema["properties"]["description"]["default"],
            ""
        );
        assert_eq!(
            create_task.input_schema["properties"]["module_id"],
            nullable_string()
        );
        let transition = tools
            .iter()
            .find(|tool| tool.name == "add_issue_type_workflow_transition")
            .unwrap();
        assert_eq!(
            transition.input_schema["properties"]["agent_allowed"]["default"],
            true
        );
    }
}
