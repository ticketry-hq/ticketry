use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{
    sea_query::{Expr, OnConflict},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder,
    Set, TransactionTrait,
};
use seaography::CustomOutputType;
use serde::Serialize;

use super::entities::app_settings as app_setting;
use super::global_launch_default::{
    GlobalLaunchDefault, PROVIDER_CATALOG_KEY, PROVIDER_CATALOG_SCOPE,
};
use super::provider_catalog_read::load_from;
use crate::work_management::entities::{
    agent_model, agent_model_reasoning_level, provider, reasoning_level,
};

const ADAPTER_SLUGS: [&str; 4] = ["claude", "agy", "codex", "gemini"];
pub(super) const CONFIGURABLE_PROVIDER_SLUGS: [&str; 3] = ["claude", "codex", "gemini"];

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct ProviderCatalog {
    /// All settings-configurable provider rows, including deactivated rows.
    pub configurable_providers: Vec<provider::Model>,
    /// Activated adapter-backed providers. Launch pickers consume only this list.
    pub providers: Vec<provider::Model>,
    /// All catalogue models, ordered by provider slug then model name. Consumers
    /// join these rows to `providers` for launches, while Settings can configure
    /// a provider that is activated in the same write.
    pub agent_models: Vec<agent_model::Model>,
    /// All reasoning rows in deterministic name order.
    pub reasoning_levels: Vec<reasoning_level::Model>,
    pub global_default: Option<GlobalLaunchDefault>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderCatalogUpdate {
    pub activated_providers: Vec<String>,
    pub global_default: Option<GlobalLaunchDefault>,
}

#[derive(Clone, Debug)]
pub struct ProviderCatalogService {
    database: DatabaseConnection,
}

impl ProviderCatalogService {
    pub fn new(database: DatabaseConnection) -> Self {
        Self { database }
    }

    pub async fn open(database: DatabaseConnection) -> Result<Self, ProviderCatalogError> {
        let service = Self::new(database);
        service.assert_adapter_catalog_match().await?;
        Ok(service)
    }

    pub async fn assert_adapter_catalog_match(&self) -> Result<(), ProviderCatalogError> {
        let rows = provider::Entity::find()
            .order_by_asc(provider::Column::Slug)
            .all(&self.database)
            .await?;
        let adapters = ADAPTER_SLUGS.into_iter().collect::<BTreeSet<_>>();
        let persisted = rows
            .iter()
            .map(|row| row.slug.as_str())
            .collect::<BTreeSet<_>>();
        let missing_rows = adapters.difference(&persisted).copied().collect::<Vec<_>>();
        let missing_adapters = persisted.difference(&adapters).copied().collect::<Vec<_>>();
        if missing_rows.is_empty() && missing_adapters.is_empty() {
            return Ok(());
        }
        let mut details = Vec::new();
        if !missing_rows.is_empty() {
            details.push(format!(
                "adapters without Provider rows: {}",
                missing_rows.join(", ")
            ));
        }
        if !missing_adapters.is_empty() {
            details.push(format!(
                "Provider rows without adapters: {}",
                missing_adapters.join(", ")
            ));
        }
        Err(ProviderCatalogError::AdapterDrift(format!(
            "Provider catalog drift: {}",
            details.join("; ")
        )))
    }

    pub async fn load(&self) -> Result<ProviderCatalog, ProviderCatalogError> {
        load_from(&self.database).await
    }

    pub async fn update(
        &self,
        update: ProviderCatalogUpdate,
    ) -> Result<ProviderCatalog, ProviderCatalogError> {
        let activated = normalized_activation(update.activated_providers)?;
        let global_default = normalize_default(update.global_default)?;
        let transaction = self.database.begin().await?;
        validate_update(&transaction, &activated, global_default.as_ref()).await?;

        for slug in CONFIGURABLE_PROVIDER_SLUGS {
            provider::Entity::update_many()
                .col_expr(
                    provider::Column::Activated,
                    Expr::value(activated.contains(slug)),
                )
                .filter(provider::Column::Slug.eq(slug))
                .exec(&transaction)
                .await?;
        }
        let value = serde_json::to_string(&PersistedProviderCatalog {
            global_default: global_default.clone(),
        })?;
        app_setting::Entity::insert(app_setting::ActiveModel {
            scope: Set(PROVIDER_CATALOG_SCOPE.to_owned()),
            key: Set(PROVIDER_CATALOG_KEY.to_owned()),
            value: Set(value),
            updated_at: Set(now()),
        })
        .on_conflict(
            OnConflict::columns([app_setting::Column::Scope, app_setting::Column::Key])
                .update_columns([app_setting::Column::Value, app_setting::Column::UpdatedAt])
                .to_owned(),
        )
        .exec(&transaction)
        .await?;
        transaction.commit().await?;
        self.load().await
    }
}

#[derive(Debug)]
pub enum ProviderCatalogError {
    AdapterDrift(String),
    Validation {
        field: &'static str,
        message: String,
    },
    Database(DbErr),
    Json(serde_json::Error),
}

impl ProviderCatalogError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::AdapterDrift(_) => "provider_catalog_drift",
            Self::Validation { .. } => "provider_catalog_validation",
            Self::Database(_) | Self::Json(_) => "provider_catalog_storage_failed",
        }
    }

    pub fn field(&self) -> Option<&'static str> {
        match self {
            Self::Validation { field, .. } => Some(field),
            _ => None,
        }
    }
}

impl std::fmt::Display for ProviderCatalogError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AdapterDrift(message) => write!(formatter, "{message}"),
            Self::Validation { message, .. } => write!(formatter, "{message}"),
            Self::Database(error) => write!(formatter, "Provider catalog storage failed: {error}"),
            Self::Json(error) => write!(formatter, "Provider catalog JSON failed: {error}"),
        }
    }
}

impl std::error::Error for ProviderCatalogError {}

impl From<DbErr> for ProviderCatalogError {
    fn from(error: DbErr) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for ProviderCatalogError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Serialize)]
struct PersistedProviderCatalog {
    global_default: Option<GlobalLaunchDefault>,
}

fn normalized_activation(values: Vec<String>) -> Result<BTreeSet<String>, ProviderCatalogError> {
    let mut normalized = BTreeSet::new();
    for value in values {
        let value = value.trim().to_owned();
        if !CONFIGURABLE_PROVIDER_SLUGS.contains(&value.as_str()) {
            return Err(validation(
                "activated_providers",
                format!("Provider '{value}' is not configurable in Settings."),
            ));
        }
        if !normalized.insert(value.clone()) {
            return Err(validation(
                "activated_providers",
                format!("Provider '{value}' was activated more than once."),
            ));
        }
    }
    Ok(normalized)
}

fn normalize_default(
    value: Option<GlobalLaunchDefault>,
) -> Result<Option<GlobalLaunchDefault>, ProviderCatalogError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let provider = value.provider.trim().to_owned();
    if provider.is_empty() {
        return Err(validation("default_provider", "Choose a catalog provider."));
    }
    let optional = |value: Option<String>| {
        value.and_then(|value| {
            let value = value.trim().to_owned();
            (!value.is_empty()).then_some(value)
        })
    };
    Ok(Some(GlobalLaunchDefault {
        provider,
        model: optional(value.model),
        reasoning: optional(value.reasoning),
    }))
}

async fn validate_update(
    database: &impl ConnectionTrait,
    activated: &BTreeSet<String>,
    default: Option<&GlobalLaunchDefault>,
) -> Result<(), ProviderCatalogError> {
    let Some(default) = default else {
        return Ok(());
    };
    let provider = provider::Entity::find()
        .filter(provider::Column::Slug.eq(&default.provider))
        .one(database)
        .await?
        .ok_or_else(|| {
            validation(
                "default_provider",
                format!("Provider '{}' is not in the catalog.", default.provider),
            )
        })?;
    if !activated.contains(&default.provider) {
        return Err(validation(
            "default_provider",
            format!(
                "Provider '{}' must be activated before it can be the global default.",
                default.provider
            ),
        ));
    }
    let provider_id = provider.id;
    let model_id = match default.model.as_deref() {
        None => None,
        Some(model) => Some(
            agent_model::Entity::find()
                .filter(agent_model::Column::ProviderId.eq(&provider_id))
                .filter(agent_model::Column::Name.eq(model))
                .one(database)
                .await?
                .ok_or_else(|| {
                    validation(
                        "default_model",
                        format!(
                            "Model '{model}' is not in the catalog for provider '{}'.",
                            default.provider
                        ),
                    )
                })?
                .id,
        ),
    };
    let Some(reasoning_name) = default.reasoning.as_deref() else {
        return Ok(());
    };
    let Some(model_id) = model_id else {
        return Err(validation(
            "default_reasoning",
            "Choose a catalog model before configuring reasoning.",
        ));
    };
    let reasoning = reasoning_level::Entity::find()
        .filter(reasoning_level::Column::Name.eq(reasoning_name))
        .one(database)
        .await?;
    let compatible = match reasoning {
        Some(reasoning) => agent_model_reasoning_level::Entity::find()
            .filter(agent_model_reasoning_level::Column::AgentModelId.eq(model_id))
            .filter(agent_model_reasoning_level::Column::ReasoningLevelId.eq(reasoning.id))
            .one(database)
            .await?
            .is_some(),
        None => false,
    };
    if !compatible {
        return Err(validation(
            "default_reasoning",
            format!(
                "Reasoning '{reasoning_name}' is not permitted for model '{}'.",
                default.model.as_deref().unwrap_or_default()
            ),
        ));
    }
    Ok(())
}

fn now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock predates the Unix epoch");
    sea_orm::prelude::DateTimeUtc::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("the system clock is outside SQLite's datetime range")
        .to_rfc3339()
}

fn validation(field: &'static str, message: impl Into<String>) -> ProviderCatalogError {
    ProviderCatalogError::Validation {
        field,
        message: message.into(),
    }
}
