//! Blocker edges and reparenting. Each write delegates to one work-management
//! command; routing adds no business rule.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use ticketry_work_management::commands::{blockers, hierarchy, CommandError};

use super::{
    projection, scope,
    tool_surface::{ToolCall, TypedTool, TypedTools},
};

pub(super) fn typed_tools() -> TypedTools {
    TypedTools::default()
        .with(TypedTool::new(
            "set_task_blockers",
            "Replace the tasks that block a task. IDs may be UUIDs or keys.",
            set_blockers,
        ))
        .with(TypedTool::new(
            "add_task_blocker",
            "Add a dependency edge: task_id is blocked by blocker_task_id.",
            |call, edge: BlockerEdge| add_blocker(call, edge.task_id, edge.blocker_task_id),
        ))
        // The reversed edge: `dependent_task_id` becomes blocked by `task_id`.
        .with(TypedTool::new(
            "add_task_dependent",
            "Add a reverse dependency edge: dependent_task_id depends on task_id.",
            |call, edge: DependentEdge| add_blocker(call, edge.dependent_task_id, edge.task_id),
        ))
        .with(TypedTool::new(
            "reparent_tasks",
            "Reparent existing work items under a parent work item.\n\nBoth parent_task_id and each entry in task_ids may be a UUID or a\nworktracker key (e.g. \"VEEVI-68\"). If module_id is omitted, the\nreparented tasks inherit the parent's module. Returns a dict with keys:\nparent_task_id, reparented, skipped, failed.",
            reparent_tasks,
        ))
}

// Field doc comments would publish as schema descriptions, so these
// parameter types keep plain comments.

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct BlockerReplacement {
    task_id: String,
    blocked_by_ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct BlockerEdge {
    task_id: String,
    blocker_task_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct DependentEdge {
    task_id: String,
    dependent_task_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
struct Reparent {
    project_id: String,
    parent_task_id: String,
    task_ids: Vec<String>,
    // Published and accepted but never read: reparented items always take
    // the parent's module. Changing that meaning is a separate decision.
    #[serde(default)]
    #[allow(dead_code)]
    module_id: Option<String>,
}

async fn set_blockers(
    call: ToolCall,
    replacement: BlockerReplacement,
) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &replacement.task_id).await?;
    let mut ids = Vec::new();
    for value in &replacement.blocked_by_ids {
        ids.push(scope::task(database, &call.principal, value).await?.id);
    }
    match blockers::change(
        database,
        blockers::BlockerChange::Replace {
            task_id: task.id.clone(),
            blocked_by_ids: ids,
        },
    )
    .await
    {
        Ok(_) => edges(database, &task.id).await,
        Err(error) => Ok(json!({"task_id": task.id, "error": error.to_string()})),
    }
}

/// Make `task_key` blocked by `blocker_key`.
async fn add_blocker(
    call: ToolCall,
    task_key: String,
    blocker_key: String,
) -> Result<Value, CommandError> {
    let database = &call.database;
    let task = scope::task(database, &call.principal, &task_key).await?;
    let blocker = scope::task(database, &call.principal, &blocker_key).await?;
    match blockers::change(
        database,
        blockers::BlockerChange::Add {
            task_id: task.id.clone(),
            blocker_id: blocker.id,
        },
    )
    .await
    {
        Ok(_) => edges(database, &task.id).await,
        Err(error) => Ok(json!({"task_id": task.id, "error": error.to_string()})),
    }
}

async fn edges(
    database: &sea_orm::DatabaseConnection,
    task_id: &str,
) -> Result<Value, CommandError> {
    let row = projection::resolve_task(database, task_id)
        .await
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    Ok(json!({
        "task_id": row.id,
        "blocked_by_ids": row.blocked_by_ids.0,
        "blocks_ids": row.blocks_ids.0
    }))
}

async fn reparent_tasks(call: ToolCall, request: Reparent) -> Result<Value, CommandError> {
    let database = &call.database;
    let principal = &call.principal;
    scope::project(database, principal, &request.project_id).await?;
    let parent_id = scope::task_or_module_id(database, principal, &request.parent_task_id).await?;
    let mut reparented = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();
    for raw_id in &request.task_ids {
        let Some(task) = projection::resolve_task(database, raw_id).await else {
            skipped.push(json!({"task_id": raw_id, "reason": "not_found"}));
            continue;
        };
        if !principal.is_global() && task.project_id != principal.project_id {
            skipped.push(json!({"task_id": raw_id, "reason": "cross_project"}));
            continue;
        }
        if task.id == parent_id {
            skipped.push(json!({"task_id": raw_id, "reason": "self_parent"}));
            continue;
        }
        match hierarchy::reparent(
            database,
            hierarchy::ReparentWorkItem {
                id: task.id.clone(),
                parent_id: Some(parent_id.clone()),
                before_id: None,
                after_id: None,
            },
            super::work_facts::work_facts(database).await.as_ref(),
        )
        .await
        {
            Ok(_) => {
                reparented.push(json!({"task_id": task.id, "previous_parent_id": task.parent_id}))
            }
            Err(error) => failed.push(json!({"task_id": task.id, "error": error.to_string()})),
        }
    }
    Ok(json!({
        "parent_task_id": parent_id,
        "reparented": reparented,
        "skipped": skipped,
        "failed": failed
    }))
}
