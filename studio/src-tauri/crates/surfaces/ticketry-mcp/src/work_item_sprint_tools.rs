//! Sprint argument presence and the committed WorkItem membership projection.

use sea_orm::{DatabaseConnection, EntityTrait};
use serde_json::{json, Map, Value};
use ticketry_entities::{issue, sprint};
use ticketry_work_management::{update_work_item_sprint, CommandError, PatchValue, SprintSelector};

use super::{
    dispatch::DispatchOutput, public_id::hyphenate, scope, work_facts::work_facts,
    workflow_tools::string, RunPrincipal,
};

pub(super) async fn update_sprint(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    arguments: &Map<String, Value>,
) -> Result<DispatchOutput, CommandError> {
    if arguments.contains_key("name") || arguments.contains_key("description") {
        return Err(CommandError::Rejected {
            message: "Sprint changes cannot be combined with name or description.".into(),
            code: "mixed_sprint_update",
            field: Some("sprint"),
        });
    }
    let task = scope::task(database, principal, string(arguments, "id_or_key")?).await?;
    update_work_item_sprint(
        database,
        &task.id,
        sprint_patch(arguments)?,
        work_facts(database).await.as_ref(),
    )
    .await?;
    Ok(DispatchOutput::direct(json!({
        "ok": true, "task_id": task.id, "key": task.key,
        "updated_fields": ["sprint"], "sprint": assigned_sprint(database, &task.id).await?,
    })))
}

pub(super) fn sprint_patch(
    arguments: &Map<String, Value>,
) -> Result<PatchValue<SprintSelector>, CommandError> {
    match arguments.get("sprint") {
        None => Ok(PatchValue::Unset),
        Some(Value::Null) => Ok(PatchValue::Null),
        Some(Value::String(value)) if value == "current" => {
            Ok(PatchValue::Value(SprintSelector::Current))
        }
        Some(Value::String(value)) if value == "next" => {
            Ok(PatchValue::Value(SprintSelector::Next))
        }
        Some(Value::String(value)) => {
            Ok(PatchValue::Value(SprintSelector::Explicit(value.clone())))
        }
        Some(_) => Err(CommandError::field(
            "sprint",
            "Submit current, next, a sprint UUID, or null.",
        )),
    }
}

pub(super) async fn assigned_sprint(
    database: &DatabaseConnection,
    task_id: &str,
) -> Result<Value, CommandError> {
    let (_, sprint) = issue::Entity::find_by_id(task_id.replace('-', ""))
        .find_also_related(sprint::Entity)
        .one(database)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work item not found.".into()))?;
    Ok(sprint.map_or(Value::Null, |sprint| {
        json!({
            "id": hyphenate(&sprint.id), "name": sprint.name, "status": sprint.status,
        })
    }))
}
