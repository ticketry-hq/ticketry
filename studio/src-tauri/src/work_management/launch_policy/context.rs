use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::settings_persistence::ProfileStore;

use super::rows::{canonical_uuid, compact_uuid, TaskRow};
use super::{LaunchPolicyError, ModuleLinkInput, SelectedProfileInput};
use crate::work_management::entities::issue;

pub(super) struct LaunchContextReader<'a> {
    database: &'a DatabaseConnection,
    profiles: &'a ProfileStore,
}

impl<'a> LaunchContextReader<'a> {
    pub(super) fn new(database: &'a DatabaseConnection, profiles: &'a ProfileStore) -> Self {
        Self { database, profiles }
    }

    pub(super) async fn resolve(
        &self,
        task: &TaskRow,
    ) -> Result<(SelectedProfileInput, ModuleLinkInput), LaunchPolicyError> {
        let catalog = self.profiles.read();
        let index = catalog.recent_profile_index.ok_or_else(|| {
            rejected(
                "profile_not_configured",
                "No selected local profile can satisfy this launch request.",
            )
        })?;
        let position = usize::try_from(index).ok();
        let profile = position
            .and_then(|position| catalog.profiles.get(position))
            .ok_or_else(|| {
                rejected(
                    "profile_not_configured",
                    "No selected local profile can satisfy this launch request.",
                )
            })?;
        if profile.workspace_slug != task.workspace_slug {
            return Err(rejected(
                "profile_workspace_mismatch",
                "The selected profile belongs to another workspace.",
            ));
        }
        let module_id = match &task.module_id {
            Some(module_id) => module_id.clone(),
            None => self.module_ancestor(task.parent_id.clone()).await?,
        };
        let path = profile
            .module_links
            .iter()
            .rev()
            .find(|link| compact_uuid(&link.module_id) == compact_uuid(&module_id))
            .map(|link| link.path.trim().to_owned())
            .filter(|path| !path.is_empty());
        crate::launch_paths::validate_module_folder(path.as_deref())
            .map_err(|failure| rejected("module_folder_unusable", failure.message()))?;
        Ok((
            SelectedProfileInput {
                index,
                name: profile.name.clone(),
                workspace_slug: profile.workspace_slug.clone(),
            },
            ModuleLinkInput {
                module_id: canonical_uuid(&module_id),
                path,
            },
        ))
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
