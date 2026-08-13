use sea_orm::DatabaseConnection;
use serde_json::{json, Map, Value};

use crate::work_management::commands::{blockers, hierarchy, CommandError};

use super::{
    backend_port::RunPrincipal, dispatch::DispatchOutput, projection, scope, workflow_tools::string,
};

pub async fn dispatch(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    name: &str,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    match name {
        "set_task_blockers" => set_blockers(database, principal, arguments).await,
        "add_task_blocker" => add_blocker(database, principal, arguments, false).await,
        "add_task_dependent" => add_blocker(database, principal, arguments, true).await,
        "reparent_tasks" => reparent_tasks(database, principal, arguments).await,
        _ => Err(CommandError::validation("Unknown dependency tool.")),
    }
}

async fn set_blockers(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    let task = scope::task(database, principal, string(arguments, "task_id")?).await?;
    let raw = arguments
        .get("blocked_by_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| CommandError::field("blocked_by_ids", "blocked_by_ids must be an array."))?;
    let mut ids = Vec::new();
    for value in raw {
        ids.push(
            scope::task(database, principal, value.as_str().unwrap_or_default())
                .await?
                .id,
        );
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
        Err(error) => Ok(DispatchOutput::direct(
            json!({"task_id": task.id, "error": error.to_string()}),
        )),
    }
}

async fn add_blocker(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
    reverse: bool,
) -> Result<DispatchOutput, CommandError> {
    let (task_key, blocker_key) = if reverse {
        (
            string(arguments, "dependent_task_id")?,
            string(arguments, "task_id")?,
        )
    } else {
        (
            string(arguments, "task_id")?,
            string(arguments, "blocker_task_id")?,
        )
    };
    let task = scope::task(database, principal, task_key).await?;
    let blocker = scope::task(database, principal, blocker_key).await?;
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
        Err(error) => Ok(DispatchOutput::direct(
            json!({"task_id": task.id, "error": error.to_string()}),
        )),
    }
}

async fn edges(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<DispatchOutput, CommandError> {
    let row = projection::resolve_task(database, task_id)
        .await
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    Ok(DispatchOutput::direct(json!({
        "task_id": row.id,
        "blocked_by_ids": row.blocked_by_ids.0,
        "blocks_ids": row.blocks_ids.0
    })))
}

async fn reparent_tasks(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    scope::project(database, principal, string(arguments, "project_id")?).await?;
    let parent_id =
        scope::task_or_module_id(database, principal, string(arguments, "parent_task_id")?).await?;
    let raw = arguments
        .get("task_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| CommandError::field("task_ids", "task_ids must be an array."))?;
    let mut reparented = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();
    for value in raw {
        let raw_id = value.as_str().unwrap_or_default();
        let Some(task) = projection::resolve_task(database, raw_id).await else {
            skipped.push(json!({"task_id": raw_id, "reason": "not_found"}));
            continue;
        };
        if task.project_id != principal.project_id {
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
        )
        .await
        {
            Ok(_) => {
                reparented.push(json!({"task_id": task.id, "previous_parent_id": task.parent_id}))
            }
            Err(error) => failed.push(json!({"task_id": task.id, "error": error.to_string()})),
        }
    }
    Ok(DispatchOutput::direct(json!({
        "parent_task_id": parent_id,
        "reparented": reparented,
        "skipped": skipped,
        "failed": failed
    })))
}
