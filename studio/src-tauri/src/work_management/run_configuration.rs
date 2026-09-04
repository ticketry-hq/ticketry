use std::collections::BTreeMap;

use sea_orm::{
    ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel, Set, TransactionTrait,
};

use crate::entities::work_management::{issue, run_configuration};

#[derive(Debug)]
pub struct RunConfigurationError {
    code: &'static str,
    message: String,
}

impl RunConfigurationError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for RunConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for RunConfigurationError {}

impl From<sea_orm::DbErr> for RunConfigurationError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::new(
            "run_configuration_storage_failed",
            format!("Run configuration storage failed: {error}"),
        )
    }
}

pub struct NewRunConfiguration {
    pub module_id: String,
    pub command: String,
    pub environment: BTreeMap<String, String>,
    pub preview_url: Option<String>,
}

pub struct RunConfigurationPatch {
    pub module_id: String,
    pub command: String,
    pub environment: BTreeMap<String, String>,
    pub preview_url: Option<String>,
}

pub async fn create(
    database: &DatabaseConnection,
    input: NewRunConfiguration,
) -> Result<run_configuration::Model, RunConfigurationError> {
    let transaction = database.begin().await?;
    let module_id = compact(&input.module_id);
    require_module(&transaction, &module_id).await?;
    let command = validated_command(input.command)?;
    let now = super::commands::timestamp::now();
    let model = run_configuration::ActiveModel {
        module_id: Set(module_id),
        command: Set(command),
        environment: Set(serde_json::to_value(input.environment).expect("map serializes")),
        preview_url: Set(normalize_optional(input.preview_url)),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&transaction)
    .await?;
    transaction.commit().await?;
    Ok(model)
}

pub async fn update(
    database: &DatabaseConnection,
    input: RunConfigurationPatch,
) -> Result<run_configuration::Model, RunConfigurationError> {
    let transaction = database.begin().await?;
    let module_id = compact(&input.module_id);
    require_module(&transaction, &module_id).await?;
    let current = run_configuration::Entity::find_by_id(&module_id)
        .one(&transaction)
        .await?
        .ok_or_else(|| {
            RunConfigurationError::new(
                "run_configuration_not_found",
                "The module has no Run configuration.",
            )
        })?;
    let mut active = current.into_active_model();
    active.command = Set(validated_command(input.command)?);
    active.environment = Set(serde_json::to_value(input.environment).expect("map serializes"));
    active.preview_url = Set(normalize_optional(input.preview_url));
    active.updated_at = Set(super::commands::timestamp::now());
    let model = active.update(&transaction).await?;
    transaction.commit().await?;
    Ok(model)
}

pub async fn delete(
    database: &DatabaseConnection,
    module_id: &str,
) -> Result<(), RunConfigurationError> {
    let result = run_configuration::Entity::delete_by_id(compact(module_id))
        .exec(database)
        .await?;
    if result.rows_affected == 0 {
        return Err(RunConfigurationError::new(
            "run_configuration_not_found",
            "The module has no Run configuration.",
        ));
    }
    Ok(())
}

async fn require_module(
    database: &impl sea_orm::ConnectionTrait,
    module_id: &str,
) -> Result<(), RunConfigurationError> {
    let module = issue::Entity::find_by_id(module_id)
        .one(database)
        .await?
        .filter(|row| row.r#type == "module");
    if module.is_none() {
        return Err(RunConfigurationError::new(
            "run_configuration_module_required",
            "A Run configuration can only belong to a module.",
        ));
    }
    Ok(())
}

fn validated_command(command: String) -> Result<String, RunConfigurationError> {
    let command = command.trim().to_owned();
    if command.is_empty() {
        return Err(RunConfigurationError::new(
            "run_configuration_command_required",
            "A Run configuration requires a command.",
        ));
    }
    Ok(command)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}
