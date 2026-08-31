use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use super::rows::{canonical_uuid, compact_uuid, TaskRow};
use super::{LaunchPolicyError, ModuleLinkInput};
use crate::entities::work_management::issue;

/// Where a launch will run, resolved from the Work Item graph alone.
///
/// The module ancestry comes from the task, and the folder from that Module's
/// own typed link. No profile index, profile selection, or feature flag takes
/// part: the Module Link is the only authority over where code lives.
pub(super) struct LaunchContextReader<'a> {
    database: &'a DatabaseConnection,
}

impl<'a> LaunchContextReader<'a> {
    pub(super) fn new(database: &'a DatabaseConnection) -> Self {
        Self { database }
    }

    pub(super) async fn resolve(
        &self,
        task: &TaskRow,
    ) -> Result<ModuleLinkInput, LaunchPolicyError> {
        let module_id = match &task.module_id {
            Some(module_id) => module_id.clone(),
            None => self.module_ancestor(task.parent_id.clone()).await?,
        };
        let folder = crate::module_links::resolution::usable_folder(self.database, &module_id)
            .await
            .map_err(|refusal| rejected("module_folder_unusable", refusal.message()))?;
        Ok(ModuleLinkInput {
            module_id: canonical_uuid(&module_id),
            path: Some(folder.to_string_lossy().into_owned()),
        })
    }

    async fn module_ancestor(
        &self,
        mut candidate: Option<String>,
    ) -> Result<String, LaunchPolicyError> {
        while let Some(id) = candidate {
            let row = issue::Entity::find_by_id(compact_uuid(&id))
                .filter(issue::Column::IsArchived.eq(false))
                .one(self.database)
                .await?;
            let Some(row) = row else {
                break;
            };
            if row.r#type == "module" {
                return Ok(row.id);
            }
            candidate = row.parent_id;
        }
        Err(rejected(
            "module_not_found",
            "The task has no active module ancestry for launch.",
        ))
    }
}

fn rejected(code: &'static str, message: impl Into<String>) -> LaunchPolicyError {
    LaunchPolicyError::rejected(code, message)
}
