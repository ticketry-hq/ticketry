use std::collections::BTreeMap;
use std::sync::Arc;

use sea_orm::{DatabaseConnection, EntityTrait};
use seaography::CustomOutputType;

use crate::entities::work_management::{issue, run_configuration};
use crate::settings_persistence::ProfileStore;

use super::{run_id, AppRunLaunch, AppRunRuntime};

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct AppRunStatus {
    pub module_id: String,
    pub run_id: String,
    pub live: bool,
}

#[derive(Debug)]
pub struct AppRunError {
    code: &'static str,
    message: String,
}

impl AppRunError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub(crate) fn runtime(message: impl Into<String>) -> Self {
        Self::new("app_run_runtime_unavailable", message)
    }
    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::new("app_run_conflict", message)
    }
    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for AppRunError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppRunError {}

impl From<sea_orm::DbErr> for AppRunError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::new(
            "app_run_storage_failed",
            format!("App run storage failed: {error}"),
        )
    }
}

#[derive(Clone)]
pub struct AppRunService {
    database: DatabaseConnection,
    profiles: ProfileStore,
    runtime: Arc<dyn AppRunRuntime>,
}

impl AppRunService {
    pub fn new(
        database: DatabaseConnection,
        profiles: ProfileStore,
        runtime: Arc<dyn AppRunRuntime>,
    ) -> Self {
        Self {
            database,
            profiles,
            runtime,
        }
    }

    pub async fn status(&self, module_id: &str) -> Result<AppRunStatus, AppRunError> {
        let module_id = compact(module_id);
        self.require_module(&module_id).await?;
        let run_id = run_id(&module_id);
        let live = self
            .runtime
            .inspect(&run_id)
            .await?
            .is_some_and(|run| run.live);
        Ok(AppRunStatus {
            module_id,
            run_id,
            live,
        })
    }

    pub async fn start(
        &self,
        module_id: &str,
        columns: u16,
        rows: u16,
    ) -> Result<AppRunStatus, AppRunError> {
        let module_id = compact(module_id);
        self.require_module(&module_id).await?;
        let configuration = run_configuration::Entity::find_by_id(&module_id)
            .one(&self.database)
            .await?
            .ok_or_else(|| {
                AppRunError::new(
                    "app_run_not_configured",
                    "The module has no Run configuration.",
                )
            })?;
        let folder = crate::worktree_status::repository::module_folder(&self.profiles, &module_id)
            .filter(|path| path.is_absolute() && path.is_dir())
            .ok_or_else(|| {
                AppRunError::new(
                    "module_folder_unusable",
                    "The module has no usable module folder.",
                )
            })?;
        let run_id = run_id(&module_id);
        if let Some(existing) = self.runtime.inspect(&run_id).await? {
            if existing.live {
                return Ok(AppRunStatus {
                    module_id,
                    run_id,
                    live: true,
                });
            }
            self.runtime
                .stop(&run_id, &existing.runtime_namespace)
                .await?;
        }
        let environment = serde_json::from_value::<BTreeMap<String, String>>(
            configuration.environment,
        )
        .map_err(|_| {
            AppRunError::new(
                "app_run_configuration_invalid",
                "The Run configuration environment is invalid.",
            )
        })?;
        self.runtime
            .start(AppRunLaunch {
                run_id: run_id.clone(),
                command: configuration.command,
                working_directory: folder,
                environment,
                columns,
                rows,
            })
            .await?;
        Ok(AppRunStatus {
            module_id,
            run_id,
            live: true,
        })
    }

    pub async fn stop(&self, module_id: &str) -> Result<AppRunStatus, AppRunError> {
        let module_id = compact(module_id);
        self.require_module(&module_id).await?;
        let run_id = run_id(&module_id);
        if let Some(existing) = self.runtime.inspect(&run_id).await? {
            self.runtime
                .stop(&run_id, &existing.runtime_namespace)
                .await?;
        }
        Ok(AppRunStatus {
            module_id,
            run_id,
            live: false,
        })
    }

    async fn require_module(&self, module_id: &str) -> Result<(), AppRunError> {
        let exists = issue::Entity::find_by_id(module_id)
            .one(&self.database)
            .await?
            .is_some_and(|row| row.r#type == "module" && !row.is_archived);
        if !exists {
            return Err(AppRunError::new(
                "app_run_module_unavailable",
                "The App run module is unavailable.",
            ));
        }
        Ok(())
    }
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
