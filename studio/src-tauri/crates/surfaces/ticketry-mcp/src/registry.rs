use std::{borrow::Cow, sync::Arc};

use rmcp::model::{JsonObject, Tool};
use serde_json::{json, Map, Value};
use ticketry_edition::{Edition, EditionCapability, EDITION};

/// One registry entry: a tool and the edition capability it requires, if any.
/// A core-only tool is one entry tagged with [`Entry::requires`].
struct Entry {
    tool: Tool,
    requires: Option<EditionCapability>,
}

impl Entry {
    fn requires(mut self, capability: EditionCapability) -> Self {
        self.requires = Some(capability);
        self
    }

    /// Publish `name` and `granted_description` only where `edition` grants
    /// `capability`; elsewhere the argument and its wording are absent.
    fn argument(
        mut self,
        edition: Edition,
        capability: EditionCapability,
        name: &'static str,
        schema: Value,
        granted_description: &'static str,
    ) -> Self {
        if edition.has(capability) {
            Arc::make_mut(&mut self.tool.input_schema)
                .get_mut("properties")
                .and_then(Value::as_object_mut)
                .expect("tool schemas carry properties")
                .insert(name.to_owned(), schema);
            self.tool.description = Some(Cow::Borrowed(granted_description));
        }
        self
    }
}

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
) -> Entry {
    Entry {
        tool: Tool::new(name, description, schema(properties, required)),
        requires: None,
    }
}

fn closed_tool(
    name: &'static str,
    description: &'static str,
    properties: Value,
    required: &[&str],
) -> Entry {
    let mut entry = tool(name, description, properties, required);
    Arc::make_mut(&mut entry.tool.input_schema)
        .insert("additionalProperties".to_owned(), Value::Bool(false));
    entry
}

fn nullable_string() -> Value {
    json!({"anyOf": [{"type": "string"}, {"type": "null"}], "default": null})
}

fn nullable_strings() -> Value {
    json!({"anyOf": [{"items": {"type": "string"}, "type": "array"}, {"type": "null"}], "default": null})
}

fn optional_nullable_string() -> Value {
    json!({"anyOf": [{"type": "string"}, {"type": "null"}]})
}

const PARALLEL_CAMPAIGN: &str = "Launch eligible direct children of a root task.\n\nOnly direct children participate. Each child launches once after every\nblocker reaches a satisfying workflow state; a durable ledger prevents\nlater re-launches.\n\nPassing ``reset=True`` clears that root's ledger first, then executes\nnewly launchable direct children. The default leaves the ledger intact.\n\nReturns ``root_id`` and task ids launched by this call.";

const SERIAL_CAMPAIGN: &str = "Run a serial campaign over the direct children of a root task.\n\nOnly direct children participate, one at a time: the campaign launches the\nfirst eligible child, and launches the next only after that child reaches a\nsatisfying workflow state and its run and terminal have ended. Each child\nlaunches once after every blocker is satisfied; a durable ledger prevents\nlater re-launches.\n\nPassing ``reset=True`` clears that root's ledger first, then starts the\ncampaign again. The default leaves the ledger intact.\n\nReturns ``root_id`` and task ids launched by this call.";

/// The tools the compiled edition publishes, in registry order.
pub fn tools() -> Vec<Tool> {
    tools_for(EDITION)
}

/// The edition gate: every entry whose required capability `edition` grants.
fn tools_for(edition: Edition) -> Vec<Tool> {
    entries(edition)
        .into_iter()
        .filter(|entry| {
            entry
                .requires
                .is_none_or(|capability| edition.has(capability))
        })
        .map(|entry| entry.tool)
        .collect()
}

fn entries(edition: Edition) -> Vec<Entry> {
    use EditionCapability::{ParallelSubtreeRuns, SprintPlanning};
    vec![
        tool("mcp_ping", "Verify MCP transport and tool execution without touching a backend.", json!({}), &[]),
        tool("terminate_current_run", "Terminate only the Studio run bound to this MCP request. This stops the run without changing or archiving its ticket. A committed handoff keeps the run alive and returns \"continued_by_handoff\" so its queued destination prompt can run.", json!({}), &[]),
        tool("add_issue_type_workflow_transition", "Add one transition to a type's workflow at the supplied revision.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"},
            "workflow_revision": {"type": "integer"}, "agent_allowed": {"type": "boolean", "default": true},
            "handoff": {"type": "boolean", "default": false}
        }), &["type_id", "from_state_id", "to_state_id", "workflow_revision"]),
        tool("add_task_blocker", "Add a dependency edge: task_id is blocked by blocker_task_id.", json!({
            "task_id": {"type": "string"}, "blocker_task_id": {"type": "string"}
        }), &["task_id", "blocker_task_id"]),
        tool("add_task_dependent", "Add a reverse dependency edge: dependent_task_id depends on task_id.", json!({
            "task_id": {"type": "string"}, "dependent_task_id": {"type": "string"}
        }), &["task_id", "dependent_task_id"]),
        tool("add_task_tags", "Add tags to a task. Existing tags are preserved and duplicate tags are returned once.", json!({
            "id_or_key": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}
        }), &["id_or_key", "tags"]),
        tool("append_task_description", "Append text to the existing description of a task.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "new_content": {"type": "string"}
        }), &["project_id", "task_id", "new_content"]),
        tool("attach_file", "Attach a local file to a task.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "file_path": {"type": "string"}
        }), &["project_id", "task_id", "file_path"]),
        tool("clear_issue_type_workflow_launch_binding", "Delete one state's launch binding and its auto-start setting.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "workflow_revision"]),
        tool("create_review_finding", "Create an Implementation finding under a Story in Review (#905).\n\nThe dedicated review-finding surface: one call creates a direct\nImplementation child, parented to a Story currently in ``Review``, born\ndirectly in the Implementation workflow's start stage, with a fixed\nevidence-block description — ``Path`` (repo-relative), inclusive\n``Lines`` (``line_start``..``line_end``), and an optional ``Note``. Findings\nunder one Story form a serial chain: each new finding is blocked by the\nlatest preceding Implementation child when one exists.\n\nReturns ``{\"ok\": True, \"task_id\", \"key\"}`` on success. On rejection it\nreturns ``{\"ok\": False, ...}`` with a machine-readable reason instead of\nraising: malformed evidence locally (implausible path, or a\nnon-inclusive / non-positive line range), and — from the backend gate — a\nparent that is not a Story, a parent not in ``Review``, or a\nforeign-project parent (``detail``/``code``/``from``/``to``).\n\nIt never launches an agent, moves the parent's state, or touches the scheduler.", json!({
            "project_id": {"type": "string"}, "parent_id": {"type": "string"}, "name": {"type": "string"},
            "path": {"type": "string"}, "line_start": {"type": "integer"}, "line_end": {"type": "integer"}, "note": nullable_string()
        }), &["project_id", "parent_id", "name", "path", "line_start", "line_end"]),
        tool("create_sub_task", "Create a sub-task with an explicit type, optionally in a named state.", json!({
            "project_id": {"type": "string"}, "parent_id": {"type": "string"}, "name": {"type": "string"},
            "issue_type": {"type": "string"}, "description": {"type": "string", "default": ""}, "state_name": nullable_string()
        }), &["project_id", "parent_id", "name", "issue_type"])
            .argument(edition, SprintPlanning, "sprint", optional_nullable_string(), "Create a sub-task with an explicit type, optionally in a named state. Sprint accepts current, next, or a UUID (with or without hyphens); null or omitted means backlog and keeps the legacy id result. Supplying a sprint returns the assigned sprint with the task identity."),
        tool("create_task", "Create a task with an explicit type, optionally in a named state.", json!({
            "project_id": {"type": "string"}, "name": {"type": "string"}, "issue_type": {"type": "string"},
            "description": {"type": "string", "default": ""}, "module_id": nullable_string(), "state_name": nullable_string()
        }), &["project_id", "name", "issue_type"])
            .argument(edition, SprintPlanning, "sprint", optional_nullable_string(), "Create a task with an explicit type, optionally in a named state. Sprint accepts current, next, or a UUID (with or without hyphens); null or omitted means backlog and keeps the legacy id result. Supplying a sprint returns the assigned sprint with the task identity."),
        tool("execute_dependency_graph", if edition.has(ParallelSubtreeRuns) { PARALLEL_CAMPAIGN } else { SERIAL_CAMPAIGN }, json!({
            "root_task_id": {"type": "string"}, "agent": nullable_string(), "reset": {"type": "boolean", "default": false}
        }), &["root_task_id"]),
        tool("get_dependency_graph", "Read a task subtree's workflow states and dependency edges.\n\nReturns the root plus factual nodes carrying ``id``, workflow-state\n``state``, ``parent_id``, and ``blocked_by`` ids. This read never\nlaunches agents and does not depend on an execution run.", json!({
            "root_task_id": {"type": "string"}
        }), &["root_task_id"]),
        tool("get_issue_type_workflow_settings", "Read one issue type's live workflow policy.\n\nReturns its start state, revision-guarded transition map with agent\npermissions, launch bindings with auto-start, and standing warnings.", json!({
            "type_id": {"type": "string"}
        }), &["type_id"]),
        closed_tool("get_sprint_goals", "Read the goals with G-numbers for an open sprint in your project.", json!({
            "sprint_id": {"type": "string"}
        }), &["sprint_id"]).requires(SprintPlanning),
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
        closed_tool("list_sprints", "Read your project's planned and active sprints in sequence order, with is_current and is_next flags. Completed sprints are omitted.", json!({
            "project_id": {"type": "string"}
        }), &["project_id"]).requires(SprintPlanning),
        tool("list_tasks", "List tasks (work items) in a project, optionally filtered by module or state.", json!({
            "project_id": {"type": "string"}, "module_id": nullable_string(), "state_name": nullable_string(),
            "include_description": {"type": "boolean", "default": false}
        }), &["project_id"]),
        tool("remove_issue_type_workflow_transition", "Remove one transition from a type's workflow at the supplied revision.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "from_state_id", "to_state_id", "workflow_revision"]),
        closed_tool("rename_codex_thread", "Rename a Codex conversation by its Codex thread id.\n\nCodex owns thread names in its own on-disk state, so this writes through\nthe one resident ``codex app-server`` Ticketry already reads titles from.\nBoth arguments are trimmed and must be non-blank; whitespace inside the\nname is preserved and no Ticketry id or length rule applies.\n\nReturns ``{\"ok\": true, \"thread_id\", \"name\"}``. Failures return a\nstructured ``{\"ok\": false, \"error\": ..., \"detail\": ...}`` result:\n``invalid_input``, ``codex_thread_not_found``,\n``codex_app_server_unavailable``, or ``codex_app_server_error``.\n\nIt never starts, resumes, or forks a thread, and touches no Ticketry row.", json!({
            "thread_id": {"type": "string"}, "name": {"type": "string"}
        }), &["thread_id", "name"]),
        tool("reparent_tasks", "Reparent existing work items under a parent work item.\n\nBoth parent_task_id and each entry in task_ids may be a UUID or a\nworktracker key (e.g. \"VEEVI-68\"). If module_id is omitted, the\nreparented tasks inherit the parent's module. Returns a dict with keys:\nparent_task_id, reparented, skipped, failed.", json!({
            "project_id": {"type": "string"}, "parent_task_id": {"type": "string"}, "task_ids": {"type": "array", "items": {"type": "string"}}, "module_id": nullable_string()
        }), &["project_id", "parent_task_id", "task_ids"]),
        tool("run_now", "Convert an eligible childless Story to an Implementation task in Implement and launch its agent with the Implementation launch settings, as one action.\n\n``id_or_key`` accepts a work-item UUID or key. The work item keeps its identity, key, content, and relationships. Rust owns refusal, destination-policy preflight, the guarded conversion, and task-scoped launch ordering. Refusals are returned as structured results; ``committed_state`` and ``committed_issue_type`` are present only when the conversion committed.", json!({
            "id_or_key": {"type": "string"}
        }), &["id_or_key"]),
        tool("set_issue_type_workflow_auto_start", "Toggle auto-start; enabling requires a valid launch binding.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "auto_start": {"type": "boolean"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "auto_start", "workflow_revision"]),
        tool("set_issue_type_workflow_start_state", "Set the issue type's start state at the supplied revision.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "state_id", "workflow_revision"]),
        tool("set_issue_type_workflow_transition_permission", "Update policy on one existing transition.", json!({
            "type_id": {"type": "string"}, "from_state_id": {"type": "string"}, "to_state_id": {"type": "string"},
            "agent_allowed": {"type": "boolean"}, "handoff": {"type": "boolean"}, "workflow_revision": {"type": "integer"}
        }), &["type_id", "from_state_id", "to_state_id", "workflow_revision"]),
        tool("set_task_blockers", "Replace the tasks that block a task. IDs may be UUIDs or keys.", json!({
            "task_id": {"type": "string"}, "blocked_by_ids": {"type": "array", "items": {"type": "string"}}
        }), &["task_id", "blocked_by_ids"]),
        closed_tool("suggest_sprint_story", "Record a suggestion for the current sprint suggestion run. Supply issue_id alone, or proposed_name and proposed_epic_id. This never assigns a story to a sprint.", json!({
            "sprint_id": {"type": "string"}, "goal_id": {"type": "string"},
            "issue_id": nullable_string(), "proposed_name": nullable_string(),
            "proposed_epic_id": nullable_string(), "reason": {"type": "string"}
        }), &["sprint_id", "goal_id", "reason"]).requires(SprintPlanning),
        tool("update_task", "Replace a task's supplied title and/or full description.", json!({
            "id_or_key": {"type": "string"}, "name": optional_nullable_string(), "description": optional_nullable_string()
        }), &["id_or_key"])
            .argument(edition, SprintPlanning, "sprint", optional_nullable_string(), "Replace a task's supplied title and/or full description, or change its sprint. Sprint accepts current, next, or a UUID (with or without hyphens); null returns to backlog and omitted leaves membership unchanged. Sprint is an exclusive patch: do not supply name or description with sprint. The result returns the assigned sprint or null."),
        tool("update_task_status", "Update the status/state of a task (e.g. 'Todo', 'Done').\n\nReturns ``{\"ok\": True, ...}`` on success, or ``{\"ok\": False, ...}`` with\nthe gate's structured reason (``detail``/``code``/``from``/``to``) when\nthe backend refuses an illegal workflow move (#872).\n\nThis tool always identifies the write as agent-origin, so the configured\ngraph and its agent permissions govern the move.", json!({
            "project_id": {"type": "string"}, "task_id": {"type": "string"}, "status_name": {"type": "string"}
        }), &["project_id", "task_id", "status_name"]),
        tool("upsert_issue_type_workflow_launch_binding", "Create or replace one state's launch binding at the supplied revision.", json!({
            "type_id": {"type": "string"}, "state_id": {"type": "string"}, "workflow_revision": {"type": "integer"},
            "prompt": nullable_string(), "agent": nullable_string(), "profile": nullable_string(), "model": nullable_string(), "reasoning": nullable_string(), "required_skills": nullable_strings(), "stage_skills": nullable_strings()
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
    fn sprint_assignment_schemas_preserve_omitted_update_membership() {
        if !ticketry_edition::has(EditionCapability::SprintPlanning) {
            return;
        }
        let tools = tools();
        for name in ["create_task", "create_sub_task", "update_task"] {
            let tool = tools.iter().find(|tool| tool.name == name).unwrap();
            let sprint = &tool.input_schema["properties"]["sprint"];
            assert_eq!(
                sprint["anyOf"],
                json!([{"type": "string"}, {"type": "null"}])
            );
            assert!(
                sprint.get("default").is_none(),
                "{name} must preserve omission"
            );
            assert!(!tool.input_schema["required"]
                .as_array()
                .unwrap()
                .contains(&json!("sprint")));
            let description = tool.description.as_ref().unwrap();
            assert!(
                description.contains("current")
                    && description.contains("next")
                    && description.contains("UUID")
            );
            if name == "update_task" {
                assert!(description.contains("exclusive") && description.contains("backlog"));
                for field in ["name", "description"] {
                    assert!(tool.input_schema["properties"][field]
                        .get("default")
                        .is_none());
                }
            }
        }
    }

    #[test]
    fn sprint_tools_publish_closed_run_scoped_contracts() {
        if !ticketry_edition::has(EditionCapability::SprintPlanning) {
            return;
        }
        let tools = tools();
        let list_sprints = tools
            .iter()
            .find(|tool| tool.name == "list_sprints")
            .expect("list_sprints tool");
        assert_eq!(
            list_sprints.input_schema.as_ref(),
            json!({
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
                "additionalProperties": false
            })
            .as_object()
            .unwrap()
        );
        for name in ["get_sprint_goals", "suggest_sprint_story"] {
            let tool = tools.iter().find(|tool| tool.name == name).unwrap();
            assert_eq!(tool.input_schema["additionalProperties"], false);
        }
        let suggestion = tools
            .iter()
            .find(|tool| tool.name == "suggest_sprint_story")
            .unwrap();
        assert_eq!(
            suggestion.input_schema["required"],
            json!(["sprint_id", "goal_id", "reason"])
        );
        for field in ["issue_id", "proposed_name", "proposed_epic_id"] {
            assert_eq!(
                suggestion.input_schema["properties"][field],
                nullable_string()
            );
        }
    }

    #[test]
    fn registry_publishes_both_editions_shared_tool_contracts() {
        let tools = tools();
        assert_eq!(
            tools
                .iter()
                .find(|tool| tool.name == "create_task")
                .unwrap()
                .input_schema["required"],
            json!(["project_id", "name", "issue_type"])
        );
        let add_task_tags = tools
            .iter()
            .find(|tool| tool.name == "add_task_tags")
            .expect("add_task_tags tool");
        assert_eq!(
            add_task_tags.input_schema["required"],
            json!(["id_or_key", "tags"])
        );
        assert_eq!(
            add_task_tags.input_schema["properties"]["tags"],
            json!({"type": "array", "items": {"type": "string"}})
        );
        let rename_codex_thread = tools
            .iter()
            .find(|tool| tool.name == "rename_codex_thread")
            .expect("rename_codex_thread tool");
        assert_eq!(
            rename_codex_thread.input_schema.as_ref(),
            json!({
                "type": "object",
                "properties": {
                    "thread_id": {"type": "string"},
                    "name": {"type": "string"}
                },
                "required": ["thread_id", "name"],
                "additionalProperties": false
            })
            .as_object()
            .unwrap()
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
        assert_eq!(
            transition.input_schema["properties"]["handoff"]["default"],
            false
        );
        let launch_binding = tools
            .iter()
            .find(|tool| tool.name == "upsert_issue_type_workflow_launch_binding")
            .unwrap();
        assert_eq!(
            launch_binding.input_schema["properties"]["stage_skills"],
            nullable_strings()
        );
        assert!(launch_binding.input_schema["properties"]
            .as_object()
            .is_some_and(|properties| !properties.contains_key("entry_skill")));
    }
}
