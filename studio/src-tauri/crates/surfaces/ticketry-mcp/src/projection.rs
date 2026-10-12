use std::collections::HashMap;

use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

mod workflow_settings;

pub use workflow_settings::workflow_settings;

use ticketry_work_management::{
    commands::attachments,
    launch_policy, read_queries,
    read_types::{IssueType, State, WorkItem},
};

pub async fn resolve_project(database: &DatabaseConnection, id_or_name: &str) -> Option<String> {
    read_queries::projects(database)
        .await
        .ok()?
        .into_iter()
        .find(|project| {
            same_id(&project.id, id_or_name)
                || project.slug.eq_ignore_ascii_case(id_or_name)
                || project.name.eq_ignore_ascii_case(id_or_name)
        })
        .map(|project| project.id)
}

pub async fn resolve_task(database: &DatabaseConnection, id_or_key: &str) -> Option<WorkItem> {
    read_queries::work_item(database, id_or_key)
        .await
        .ok()
        .flatten()
}

pub async fn resolve_issue_type(
    database: &DatabaseConnection,
    project_id: &str,
    id_or_name: &str,
) -> Option<IssueType> {
    read_queries::issue_types(database, project_id)
        .await
        .ok()?
        .into_iter()
        .find(|kind| same_id(&kind.id, id_or_name) || kind.name.eq_ignore_ascii_case(id_or_name))
}

pub async fn resolve_state(
    database: &DatabaseConnection,
    project_id: &str,
    name: &str,
) -> Option<State> {
    read_queries::states(database, project_id)
        .await
        .ok()?
        .into_iter()
        .find(|state| state.name.eq_ignore_ascii_case(name))
}

/// Every project, with the installation's own project first.
///
/// An agent without launch context takes the first entry as the installation
/// project, so this orders by the same resolution the rest of the app uses
/// rather than by creation order alone. A database adopted from the Workspace
/// era can hold several projects whose oldest is not the installation's, and
/// leading with that one would point MCP at a different project than startup
/// and onboarding resolved.
pub async fn list_projects(database: &DatabaseConnection) -> Value {
    let mut rows = read_queries::projects(database).await.unwrap_or_default();
    if let Ok(Some(installation)) =
        ticketry_work_management::project_onboarding_migration::installation_project_id(database)
            .await
    {
        if let Some(position) = rows.iter().position(|row| same_id(&row.id, &installation)) {
            rows[..=position].rotate_right(1);
        }
    }
    Value::Array(
        rows.into_iter()
            .map(|row| {
                json!({
                    "id": row.id,
                    "name": row.name,
                    "identifier": row.slug,
                    "description": row.description,
                })
            })
            .collect(),
    )
}

pub async fn list_issue_types(database: &DatabaseConnection, project_id: &str) -> Value {
    let rows = read_queries::issue_types(database, project_id)
        .await
        .unwrap_or_default();
    Value::Array(rows.iter().map(issue_type_json).collect())
}

pub async fn list_modules(database: &DatabaseConnection, project_id: &str) -> Value {
    let kinds = issue_types_by_id(database, project_id).await;
    let rows = read_queries::modules(database, project_id, false)
        .await
        .unwrap_or_default();
    Value::Array(
        rows.into_iter()
            .filter_map(|row| {
                let kind = kinds.get(&row.issue_type)?;
                Some(json!({
                    "id": row.id,
                    "name": row.name,
                    "project_id": row.project_id,
                    "sequence_id": row.sequence_id,
                    "key": row.key,
                    "is_archived": row.is_archived,
                    "issue_type": issue_type_json(kind),
                }))
            })
            .collect(),
    )
}

pub async fn list_tasks(
    database: &DatabaseConnection,
    project_id: &str,
    module_id: Option<&str>,
    state_id: Option<&str>,
    include_description: bool,
) -> Value {
    let kinds = issue_types_by_id(database, project_id).await;
    let rows = read_queries::work_items(database, Some(project_id), module_id, state_id)
        .await
        .unwrap_or_default();
    Value::Array(
        rows.into_iter()
            .filter_map(|row| task_json(&row, &kinds, include_description))
            .collect(),
    )
}

pub async fn task_details(database: &DatabaseConnection, task: &WorkItem) -> Value {
    let kinds = issue_types_by_id(database, &task.project_id).await;
    let mut detail = match task_json(task, &kinds, true) {
        Some(Value::Object(object)) => object,
        _ => return Value::Null,
    };
    let children = read_queries::work_items(database, Some(&task.project_id), None, None)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|row| row.parent_id.as_deref() == Some(&task.id))
        .filter_map(|row| task_json(&row, &kinds, false))
        .collect();
    let attachments = attachments::list(database, &task.id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            json!({
                "id": hyphenate(&row.id),
                "name": row.filename,
                "mime_type": row.mime_type,
                "size": row.size.unwrap_or_default(),
                "asset_url": format!("/media/{}", row.file),
            })
        })
        .collect();
    detail.insert("sub_tasks".to_owned(), Value::Array(children));
    detail.insert("attachments".to_owned(), Value::Array(attachments));
    detail.insert(
        "launch_policy_rejections".to_owned(),
        launch_policy_rejections(database, &task.id).await,
    );
    Value::Object(detail)
}

/// Why an auto-start transition on this work item has not launched. Without
/// this the ledger is invisible: the item moves into an auto-start state and
/// then nothing observable happens.
async fn launch_policy_rejections(database: &DatabaseConnection, work_item_id: &str) -> Value {
    let rows = launch_policy::rejections_for_work_item(database, work_item_id)
        .await
        .unwrap_or_default();
    serde_json::to_value(rows).unwrap_or(Value::Array(Vec::new()))
}

pub async fn scope_context(database: &DatabaseConnection, task: &WorkItem) -> Value {
    let all = read_queries::work_items(database, Some(&task.project_id), None, None)
        .await
        .unwrap_or_default();
    let by_id: HashMap<&str, &WorkItem> = all.iter().map(|item| (item.id.as_str(), item)).collect();
    let states: HashMap<String, State> = read_queries::states(database, &task.project_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|state| (state.id.clone(), state))
        .collect();
    let as_ref = |item: &WorkItem| {
        let state = item.state.as_ref().and_then(|id| states.get(id));
        json!({
            "id": item.id,
            "key": item.key,
            "name": item.name,
            "state_group": state.map(|state| state.group.as_str()),
            "resolved": state.is_some_and(|state| matches!(state.group.as_str(), "completed" | "cancelled") || state.name == "Review"),
        })
    };
    let depends_on: Vec<Value> = task
        .blocked_by_ids
        .0
        .iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .map(as_ref)
        .collect();
    let depended_by: Vec<Value> = task
        .blocks_ids
        .0
        .iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .map(as_ref)
        .collect();
    let unresolved: Vec<&str> = depends_on
        .iter()
        .filter(|item| item["resolved"] == false)
        .filter_map(|item| item["key"].as_str())
        .collect();
    let advisory = if unresolved.is_empty() {
        "No unresolved blockers - deliver only this task and nothing beyond its scope.".to_owned()
    } else {
        format!(
            "{} of {} blocker(s) unresolved ({}) - stay within this task; do not implement upstream work.",
            unresolved.len(),
            depends_on.len(),
            unresolved.join(", ")
        )
    };
    json!({"task": as_ref(task), "depends_on": depends_on, "depended_by": depended_by, "advisory": advisory})
}

fn task_json(
    item: &WorkItem,
    kinds: &HashMap<String, IssueType>,
    include_description: bool,
) -> Option<Value> {
    let kind = kinds.get(&item.issue_type)?;
    Some(json!({
        "id": item.id,
        "name": item.name,
        "project_id": item.project_id,
        "state_id": item.state,
        "description": include_description.then_some(item.description.as_str()),
        "sequence_id": item.sequence_id,
        "key": item.key,
        "parent_id": item.parent_id,
        "issue_type": issue_type_json(kind),
        "is_archived": item.is_archived,
        "blocked_by_ids": item.blocked_by_ids.0,
        "blocks_ids": item.blocks_ids.0,
    }))
}

fn issue_type_json(kind: &IssueType) -> Value {
    json!({"id": kind.id, "name": kind.name, "level": kind.level, "color": kind.color, "sort_order": kind.sort_order})
}

async fn issue_types_by_id(
    database: &DatabaseConnection,
    project_id: &str,
) -> HashMap<String, IssueType> {
    read_queries::issue_types(database, project_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|kind| (kind.id.clone(), kind))
        .collect()
}

fn same_id(left: &str, right: &str) -> bool {
    left.replace('-', "")
        .eq_ignore_ascii_case(&right.replace('-', ""))
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
