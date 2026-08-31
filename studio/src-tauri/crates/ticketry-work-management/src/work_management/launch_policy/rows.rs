use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use super::LaunchPolicyError;
use ticketry_entities::work_management::{issue, issue_type, launch_binding, project, state};

pub(super) struct PolicyReader<'a> {
    database: &'a DatabaseConnection,
}

impl<'a> PolicyReader<'a> {
    pub(super) fn new(database: &'a DatabaseConnection) -> Self {
        Self { database }
    }

    pub(super) async fn task(&self, task_id: &str) -> Result<TaskRow, LaunchPolicyError> {
        let issue = issue::Entity::find_by_id(compact_uuid(task_id))
            .filter(issue::Column::Type.eq("task"))
            .filter(issue::Column::IsArchived.eq(false))
            .one(self.database)
            .await?
            .ok_or_else(|| LaunchPolicyError::rejected("task_not_found", "Task not found."))?;
        let kind = issue_type::Entity::find_by_id(&issue.issue_type_id)
            .one(self.database)
            .await?
            .ok_or_else(|| LaunchPolicyError::rejected("task_not_found", "Task type not found."))?;
        if project::Entity::find_by_id(&issue.project_id)
            .one(self.database)
            .await?
            .is_none()
        {
            return Err(LaunchPolicyError::rejected(
                "task_not_found",
                "Task project not found.",
            ));
        }
        Ok(TaskRow {
            id: issue.id,
            project_id: issue.project_id,
            issue_type_id: issue.issue_type_id,
            state_id: issue.state_id,
            parent_id: issue.parent_id,
            module_id: issue.module_id,
            workflow_revision: kind.workflow_revision,
        })
    }

    pub(super) async fn binding(
        &self,
        issue_type_id: &str,
        state_id: &str,
    ) -> Result<Option<BindingRow>, LaunchPolicyError> {
        Ok(launch_binding::Entity::find()
            .filter(launch_binding::Column::IssueTypeId.eq(issue_type_id))
            .filter(launch_binding::Column::StateId.eq(compact_uuid(state_id)))
            .one(self.database)
            .await?
            .map(|row| BindingRow {
                id: row.id,
                prompt: row.prompt,
                required_skills: row.required_skills.to_string(),
                model_id: row.model_id,
                reasoning_id: row.reasoning_id,
                auto_start: row.auto_start,
                subtree_run_enabled: row.subtree_run_enabled,
            }))
    }

    pub(super) async fn state_name(
        &self,
        project_id: &str,
        state_id: &str,
    ) -> Result<String, LaunchPolicyError> {
        state::Entity::find_by_id(compact_uuid(state_id))
            .filter(state::Column::ProjectId.eq(compact_uuid(project_id)))
            .one(self.database)
            .await?
            .map(|row| row.name)
            .ok_or_else(|| {
                LaunchPolicyError::rejected(
                    "launch_context_incomplete",
                    "The workflow state selected for launch is unavailable.",
                )
            })
    }
}

pub(super) fn compact_uuid(value: &str) -> String {
    value.replace('-', "")
}

pub(super) fn canonical_uuid(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|identifier| identifier.to_string())
        .unwrap_or_else(|_| value.to_owned())
}

pub(super) struct TaskRow {
    pub(super) id: String,
    pub(super) project_id: String,
    pub(super) issue_type_id: String,
    pub(super) state_id: Option<String>,
    pub(super) parent_id: Option<String>,
    pub(super) module_id: Option<String>,
    pub(super) workflow_revision: i32,
}

pub(super) struct BindingRow {
    pub(super) id: i64,
    pub(super) prompt: String,
    pub(super) required_skills: String,
    pub(super) model_id: Option<String>,
    pub(super) reasoning_id: Option<String>,
    pub(super) auto_start: bool,
    pub(super) subtree_run_enabled: bool,
}

impl BindingRow {
    pub(super) fn has_policy(&self) -> bool {
        !self.prompt.is_empty()
            || self.model_id.is_some()
            || self.reasoning_id.is_some()
            || self.required_skills != "[]"
    }
}
