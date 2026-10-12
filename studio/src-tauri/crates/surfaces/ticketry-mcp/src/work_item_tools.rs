//! Work-item creates, updates, tags and status moves. Each delegates to one
//! work-management command; routing adds no business rule.

use super::{
    projection, scope,
    tool_surface::{rejection, ToolCall, TypedTool, TypedTools},
};
use super::{public_id::hyphenate, work_facts::work_facts};
use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Value};
use ticketry_work_management::commands::CommandError;
use ticketry_work_management::commands::{tags, work_items, workflow};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(TypedTool::new(
            "create_task",
            "Create a task with an explicit type, optionally in a named state.",
            create::<NewTask>,
        ).answers_under_result())
        .with(TypedTool::new(
            "create_sub_task",
            "Create a sub-task with an explicit type, optionally in a named state.",
            create::<NewSubTask>,
        ).answers_under_result())
        .with(TypedTool::new(
            "create_review_finding",
            "Create an Implementation finding under a Story in Review (#905).\n\nThe dedicated review-finding surface: one call creates a direct\nImplementation child, parented to a Story currently in ``Review``, born\ndirectly in the Implementation workflow's start stage, with a fixed\nevidence-block description — ``Path`` (repo-relative), inclusive\n``Lines`` (``line_start``..``line_end``), and an optional ``Note``. Findings\nunder one Story form a serial chain: each new finding is blocked by the\nlatest preceding Implementation child when one exists.\n\nReturns ``{\"ok\": True, \"task_id\", \"key\"}`` on success. On rejection it\nreturns ``{\"ok\": False, ...}`` with a machine-readable reason instead of\nraising: malformed evidence locally (implausible path, or a\nnon-inclusive / non-positive line range), and — from the backend gate — a\nparent that is not a Story, a parent not in ``Review``, or a\nforeign-project parent (``detail``/``code``/``from``/``to``).\n\nIt never launches an agent, moves the parent's state, or touches the scheduler.",
            create_review_finding,
        ))
        .with(TypedTool::new("add_task_tags", "Add tags to a task. Existing tags are preserved and duplicate tags are returned once.", add_task_tags))
        .with(TypedTool::new("update_task", "Replace a task's supplied title and/or full description.", update_task))
        .with(TypedTool::new(
            "append_task_description",
            "Append text to the existing description of a task.",
            append_description,
        ).answers_under_result())
        .with(TypedTool::new(
            "update_task_status",
            "Update the status/state of a task (e.g. 'Todo', 'Done').\n\nReturns ``{\"ok\": True, ...}`` on success, or ``{\"ok\": False, ...}`` with\nthe gate's structured reason (``detail``/``code``/``from``/``to``) when\nthe backend refuses an illegal workflow move (#872).\n\nThis tool always identifies the write as agent-origin, so the configured\ngraph and its agent permissions govern the move.",
            update_status,
        ))
}

async fn add_task_tags(call: ToolCall, addition: TagAddition) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &addition.id_or_key).await?;
    let current_tags = tags::add(
        database,
        &task.id,
        addition.tags.0,
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(json!({
        "ok": true,
        "task_id": task.id,
        "key": task.key,
        "tags": current_tags,
    }))
}

// Field doc comments would publish as schema descriptions, so these
// parameter types keep plain comments.

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct NewTask {
    project_id: String,
    name: String,
    issue_type: String,
    // Omitted stores the same empty description the command stores for none.
    #[serde(default)]
    description: String,
    #[serde(default)]
    module_id: Option<String>,
    #[serde(default)]
    state_name: Option<String>,
}

// The parent replaces `module_id`, which this tool does not publish; a
// supplied one is ignored like any unknown key.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct NewSubTask {
    project_id: String,
    parent_id: String,
    name: String,
    issue_type: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    state_name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TagAddition {
    id_or_key: String,
    #[schemars(with = "Vec<String>")]
    tags: TagNames,
}

/// Raw tag names; the tags command trims, drops blanks and deduplicates them.
struct TagNames(Vec<String>);

/// Keeps the field-specific messages agents already receive for `tags`.
impl<'de> Deserialize<'de> for TagNames {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let Value::Array(values) = Value::deserialize(deserializer)? else {
            return Err(serde::de::Error::custom("tags must be an array."));
        };
        values
            .into_iter()
            .map(|value| match value {
                Value::String(name) => Ok(name),
                _ => Err(serde::de::Error::custom("tags values must be strings.")),
            })
            .collect::<Result<_, _>>()
            .map(Self)
    }
}

// `name` and `description` replace the stored value when supplied; null
// means the same as omitted and never clears either.
#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct TaskUpdate {
    id_or_key: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct DescriptionAppend {
    project_id: String,
    task_id: String,
    new_content: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct StatusChange {
    project_id: String,
    task_id: String,
    status_name: String,
}

/// What either create tool asks of the one create command.
struct TaskCreation {
    project_id: String,
    name: String,
    issue_type: String,
    description: String,
    state_name: Option<String>,
    parent_id: Option<String>,
}

impl From<NewTask> for TaskCreation {
    fn from(task: NewTask) -> Self {
        Self {
            project_id: task.project_id,
            name: task.name,
            issue_type: task.issue_type,
            description: task.description,
            state_name: task.state_name,
            parent_id: task.module_id,
        }
    }
}

impl From<NewSubTask> for TaskCreation {
    fn from(task: NewSubTask) -> Self {
        Self {
            project_id: task.project_id,
            name: task.name,
            issue_type: task.issue_type,
            description: task.description,
            state_name: task.state_name,
            parent_id: Some(task.parent_id),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct ReviewFinding {
    project_id: String,
    parent_id: String,
    name: String,
    path: String,
    line_start: LineNumber,
    line_end: LineNumber,
    #[serde(default)]
    note: Option<String>,
}

/// A 1-based source line. Zero, negative and non-integer lines are refused at
/// the tool boundary instead of reaching the evidence check as 0.
struct LineNumber(i64);

impl<'de> Deserialize<'de> for LineNumber {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match i64::deserialize(deserializer)? {
            line if line >= 1 => Ok(Self(line)),
            line => Err(serde::de::Error::custom(format!(
                "line {line} is not a positive line number"
            ))),
        }
    }
}

impl JsonSchema for LineNumber {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        "LineNumber".into()
    }

    fn json_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({"type": "integer", "minimum": 1})
    }
}

async fn create<P: Into<TaskCreation>>(
    call: ToolCall,
    parameters: P,
) -> Result<Value, CommandError> {
    let task = parameters.into();
    let (database, principal) = (&call.database, &call.principal);
    let project = scope::project(database, principal, &task.project_id).await?;
    let kind = projection::resolve_issue_type(database, &project, &task.issue_type)
        .await
        .ok_or_else(|| CommandError::field("issue_type", "Unknown task issue type."))?;
    let state_id = match task.state_name.as_deref() {
        Some(name) => Some(
            projection::resolve_state(database, &project, name)
                .await
                .ok_or_else(|| CommandError::field("state_name", "Unknown workflow state."))?
                .id,
        ),
        None => None,
    };
    if let Some(parent_id) = task.parent_id.as_deref() {
        scope::task_or_module_id(database, principal, parent_id).await?;
    }
    let id = work_items::create(
        database,
        work_items::CreateWorkItem {
            project_id: project,
            name: task.name,
            issue_type_id: kind.id,
            description: Some(task.description),
            state_id,
            parent_id: task.parent_id,
        },
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(Value::String(hyphenate(&id)))
}

async fn create_review_finding(
    call: ToolCall,
    finding: ReviewFinding,
) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    let project = scope::project(database, principal, &finding.project_id).await?;
    let parent = scope::task(database, principal, &finding.parent_id).await?;
    let facts = work_facts(database).await;
    let id = work_items::create_review_finding(
        database,
        work_items::CreateReviewFinding {
            project_id: project,
            parent_id: parent.id,
            name: finding.name,
            path: finding.path,
            line_start: finding.line_start.0,
            line_end: finding.line_end.0,
            note: finding.note,
        },
        facts.as_ref(),
    )
    .await?;
    let created = projection::resolve_task(database, &id)
        .await
        .ok_or_else(|| CommandError::NotFound("Created finding not found.".to_owned()))?;
    Ok(json!({"ok": true, "task_id": created.id, "key": created.key}))
}

async fn update_task(call: ToolCall, update: TaskUpdate) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &update.id_or_key).await?;
    let mut fields = Vec::new();
    if update.name.is_some() {
        fields.push("name");
    }
    if update.description.is_some() {
        fields.push("description");
    }
    work_items::update(
        database,
        work_items::UpdateWorkItem {
            id: task.id.clone(),
            name: update.name,
            description: update.description,
            issue_type_id: None,
        },
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(json!({"ok": true, "task_id": task.id, "key": task.key, "updated_fields": fields}))
}

async fn append_description(
    call: ToolCall,
    append: DescriptionAppend,
) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    scope::project(database, principal, &append.project_id).await?;
    let task = scope::task(database, principal, &append.task_id).await?;
    work_items::append_description(
        database,
        work_items::AppendDescription {
            id: task.id,
            new_content: append.new_content,
        },
    )
    .await?;
    Ok(Value::Bool(true))
}

async fn update_status(call: ToolCall, change: StatusChange) -> Result<Value, CommandError> {
    let (database, principal) = (&call.database, &call.principal);
    let project = scope::project(database, principal, &change.project_id).await?;
    let task = scope::task(database, principal, &change.task_id).await?;
    let status_name = change.status_name;
    let Some(state) = projection::resolve_state(database, &project, &status_name).await else {
        return Ok(
            json!({"ok": false, "task_id": task.id, "error": format!("Unknown workflow state {status_name:?}.")}),
        );
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
        Ok(_) => Ok(json!({"ok": true, "task_id": task.id, "status": status_name})),
        Err(error) => {
            let mut body = rejection(&error);
            body["task_id"] = Value::String(task.id);
            Ok(body)
        }
    }
}
