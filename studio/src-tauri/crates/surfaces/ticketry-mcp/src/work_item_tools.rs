use super::{
    dispatch::DispatchOutput,
    projection, scope,
    workflow_tools::{self, optional_string, string},
    RunPrincipal,
};
use super::{public_id::hyphenate, work_facts::work_facts};
use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};
use ticketry_work_management::commands::CommandError;
use ticketry_work_management::commands::{tags, work_items, workflow};

pub(super) async fn dispatch(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    match name {
        "create_task" => create_task(database, principal, arguments, None).await,
        "create_sub_task" => {
            let parent = string(arguments, "parent_id")?;
            create_task(database, principal, arguments, Some(parent)).await
        }
        "create_review_finding" => create_review_finding(database, principal, arguments).await,
        "add_task_tags" => add_task_tags(database, principal, arguments).await,
        "update_task" => update_task(database, principal, arguments).await,
        "append_task_description" => append_description(database, principal, arguments).await,
        "update_task_status" => update_status(database, principal, arguments).await,
        _ => Err(CommandError::validation(
            "Unknown WorkTracker work-item tool.",
        )),
    }
}

async fn add_task_tags(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
    let raw = arguments
        .get("tags")
        .and_then(Value::as_array)
        .ok_or_else(|| CommandError::field("tags", "tags must be an array."))?;
    let names = raw
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| CommandError::field("tags", "tags values must be strings."))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let current_tags = tags::add(
        database,
        &task.id,
        names,
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(DispatchOutput::direct(json!({
        "ok": true,
        "task_id": task.id,
        "key": task.key,
        "tags": current_tags,
    })))
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

async fn create_review_finding(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let project = scope::project(database, principal, string(arguments, "project_id")?).await?;
    let parent = scope::task(database, principal, string(arguments, "parent_id")?).await?;
    let facts = work_facts(database).await;
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
        facts.as_ref(),
    )
    .await?;
    let created = projection::resolve_task(database, &id)
        .await
        .ok_or_else(|| CommandError::NotFound("Created finding not found.".to_owned()))?;
    Ok(DispatchOutput::direct(
        json!({"ok": true, "task_id": created.id, "key": created.key}),
    ))
}
