//! The WorkTracker facts a launch prompt is built from.
//!
//! Every value here is read from the durable Work Item graph, never echoed
//! from the launch request.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

use crate::entities::work_management::{issue, issue_type, project, state, workspace};
use crate::launch_planning::{ModulePromptFacts, TaskPromptFacts, TaskSummary};

use super::error::LaunchAuthorityError;

/// A planning prompt lists the module's tasks. The list is bounded so one
/// crowded module cannot grow a prompt without limit.
pub(super) const MODULE_TASK_LIMIT: u64 = 200;

pub(super) fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) fn canonical(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.to_string())
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) async fn work_item(
    database: &DatabaseConnection,
    id: &str,
) -> Result<issue::Model, LaunchAuthorityError> {
    issue::Entity::find_by_id(compact(id))
        .one(database)
        .await?
        .ok_or_else(|| LaunchAuthorityError::unresolvable("The launch Work Item is unavailable."))
}

pub(super) async fn workspace_slug(
    database: &DatabaseConnection,
    project_id: &str,
) -> Result<String, LaunchAuthorityError> {
    let project = project::Entity::find_by_id(compact(project_id))
        .one(database)
        .await?
        .ok_or_else(|| LaunchAuthorityError::unresolvable("The launch project is unavailable."))?;
    workspace::Entity::find_by_id(project.workspace_id)
        .one(database)
        .await?
        .map(|row| row.slug)
        .ok_or_else(|| LaunchAuthorityError::unresolvable("The launch workspace is unavailable."))
}

/// The factual work-item context block of a task prompt.
pub(super) async fn task_prompt_facts(
    database: &DatabaseConnection,
    task: &issue::Model,
    module_id: &str,
    local_module_folder: String,
    state_name: Option<String>,
) -> Result<TaskPromptFacts, LaunchAuthorityError> {
    let issue_type = issue_type::Entity::find_by_id(&task.issue_type_id)
        .one(database)
        .await?
        .map(|row| row.name)
        .unwrap_or_default();
    let state = match state_name {
        Some(name) => name,
        None => match task.state_id.as_deref() {
            Some(state_id) => state::Entity::find_by_id(compact(state_id))
                .one(database)
                .await?
                .map(|row| row.name)
                .unwrap_or_default(),
            None => String::new(),
        },
    };
    Ok(TaskPromptFacts {
        name: task.name.clone(),
        work_item_id: canonical(&task.id),
        sequence_id: Some(i64::from(task.sequence_id)),
        project_id: canonical(&task.project_id),
        workspace_slug: workspace_slug(database, &task.project_id).await?,
        module_id: canonical(module_id),
        local_module_folder,
        state,
        issue_type,
        description_html: task.description.clone(),
    })
}

/// The module context shared by planning and instant prompts.
pub(super) async fn module_prompt_facts(
    database: &DatabaseConnection,
    module_id: &str,
    local_codebase: Option<String>,
) -> Result<ModulePromptFacts, LaunchAuthorityError> {
    let module = work_item(database, module_id).await?;
    Ok(ModulePromptFacts {
        name: module.name,
        module_id: canonical(&module.id),
        workspace_slug: workspace_slug(database, &module.project_id).await?,
        project_id: canonical(&module.project_id),
        local_codebase,
    })
}

/// The module's live tasks, in board order, for the planning prompt.
pub(super) async fn module_task_summaries(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<Vec<TaskSummary>, LaunchAuthorityError> {
    let rows = issue::Entity::find()
        .filter(issue::Column::ModuleId.eq(compact(module_id)))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .order_by_asc(issue::Column::Rank)
        .limit(MODULE_TASK_LIMIT)
        .all(database)
        .await?;
    let mut summaries = Vec::with_capacity(rows.len());
    for row in rows {
        let state = match row.state_id.as_deref() {
            Some(state_id) => state::Entity::find_by_id(compact(state_id))
                .one(database)
                .await?
                .map(|row| row.name)
                .unwrap_or_else(|| "Unknown".to_owned()),
            None => "Unknown".to_owned(),
        };
        summaries.push(TaskSummary {
            name: row.name,
            sequence_id: Some(i64::from(row.sequence_id)),
            state,
        });
    }
    Ok(summaries)
}
