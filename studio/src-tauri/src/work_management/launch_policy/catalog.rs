use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use super::rows::BindingRow;
use super::LaunchPolicyError;
use crate::settings_persistence::{read_global_launch_default, GlobalLaunchDefault};
use crate::entities::work_management::{
    agent_model, agent_model_reasoning_level, provider, reasoning_level,
};

pub(super) struct CatalogReader<'a> {
    database: &'a DatabaseConnection,
}

pub(super) struct ProviderSelection {
    pub(super) provider: String,
    pub(super) model: Option<String>,
    pub(super) reasoning: Option<String>,
    pub(super) supports_unattended: bool,
}

impl<'a> CatalogReader<'a> {
    pub(super) fn new(database: &'a DatabaseConnection) -> Self {
        Self { database }
    }

    pub(super) async fn resolve(
        &self,
        binding: &BindingRow,
        provider_override: Option<&str>,
    ) -> Result<ProviderSelection, LaunchPolicyError> {
        let configured_model = match binding.model_id.as_deref() {
            Some(model_id) => Some(self.model_by_id(model_id).await?),
            None => None,
        };
        if binding.reasoning_id.is_some() && configured_model.is_none() {
            return Err(rejected(
                "model_required",
                "Choose a catalog model before configuring reasoning.",
            ));
        }

        let configured_provider = configured_model
            .as_ref()
            .map(|model| model.provider_slug.as_str());
        let mut provider = provider_override.or(configured_provider).map(str::to_owned);
        let provider_changed = provider_override.is_some()
            && configured_provider.is_some()
            && provider_override != configured_provider;
        let mut model = (!provider_changed).then_some(configured_model).flatten();
        let mut reasoning_id = (!provider_changed)
            .then(|| binding.reasoning_id.clone())
            .flatten();

        if let Some(default) = self.global_default().await? {
            if provider.is_none() {
                provider = Some(default.provider);
                model = match default.model {
                    Some(name) => Some(
                        self.model_by_name(provider.as_deref().unwrap(), &name)
                            .await?,
                    ),
                    None => None,
                };
                reasoning_id = match default.reasoning {
                    Some(name) => Some(self.reasoning_by_name(&name).await?.id),
                    None => None,
                };
            } else if provider.as_deref() == Some(default.provider.as_str()) {
                if model.is_none() {
                    model = match default.model {
                        Some(name) => Some(self.model_by_name(&default.provider, &name).await?),
                        None => None,
                    };
                }
                if reasoning_id.is_none() {
                    reasoning_id = match default.reasoning {
                        Some(name) => Some(self.reasoning_by_name(&name).await?.id),
                        None => None,
                    };
                }
            }
        }

        let provider = provider.ok_or_else(|| {
            rejected(
                "agent_not_configured",
                "This launch binding has no resolved agent/provider.",
            )
        })?;
        let provider_row = self.provider(&provider).await?;
        require_activated(&provider_row)?;
        if let Some(selected) = &model {
            if selected.provider_slug != provider {
                return Err(rejected(
                    "unsupported_model",
                    format!(
                        "Model '{}' is not in the catalog for agent/provider '{}'.",
                        selected.name, provider
                    ),
                ));
            }
        }
        let reasoning = match reasoning_id {
            Some(reasoning_id) => {
                let model = model.as_ref().ok_or_else(|| {
                    rejected(
                        "model_required",
                        "Choose a catalog model before configuring reasoning.",
                    )
                })?;
                self.compatible_reasoning(&model.id, &reasoning_id).await?
            }
            None => None,
        };

        Ok(ProviderSelection {
            provider,
            model: model.map(|value| value.name),
            reasoning,
            supports_unattended: provider_row.supports_unattended,
        })
    }

    async fn provider(&self, slug: &str) -> Result<provider::Model, LaunchPolicyError> {
        provider::Entity::find()
            .filter(provider::Column::Slug.eq(slug))
            .one(self.database)
            .await?
            .ok_or_else(|| {
                rejected(
                    "unknown_agent",
                    format!("Agent/provider '{slug}' is not supported."),
                )
            })
    }

    async fn model_by_id(&self, id: &str) -> Result<ModelRow, LaunchPolicyError> {
        let row = agent_model::Entity::find_by_id(id)
            .find_also_related(provider::Entity)
            .one(self.database)
            .await?;
        model_row(row)
            .ok_or_else(|| rejected("unsupported_model", "Model is not in the agent catalog."))
    }

    async fn model_by_name(
        &self,
        provider: &str,
        name: &str,
    ) -> Result<ModelRow, LaunchPolicyError> {
        let provider_row = provider::Entity::find()
            .filter(provider::Column::Slug.eq(provider))
            .one(self.database)
            .await?;
        let row = match provider_row {
            Some(provider_row) => agent_model::Entity::find()
                .filter(agent_model::Column::ProviderId.eq(provider_row.id))
                .filter(agent_model::Column::Name.eq(name))
                .one(self.database)
                .await?
                .map(|model| ModelRow {
                    id: model.id,
                    name: model.name,
                    provider_slug: provider_row.slug,
                }),
            None => None,
        };
        row.ok_or_else(|| {
            rejected(
                "unsupported_model",
                format!("Model '{name}' is not in the catalog for agent/provider '{provider}'."),
            )
        })
    }

    async fn reasoning_by_name(
        &self,
        name: &str,
    ) -> Result<reasoning_level::Model, LaunchPolicyError> {
        reasoning_level::Entity::find()
            .filter(reasoning_level::Column::Name.eq(name))
            .one(self.database)
            .await?
            .ok_or_else(|| rejected("unsupported_reasoning", "Reasoning is not in the catalog."))
    }

    async fn compatible_reasoning(
        &self,
        model_id: &str,
        reasoning_id: &str,
    ) -> Result<Option<String>, LaunchPolicyError> {
        let compatible = agent_model_reasoning_level::Entity::find()
            .filter(agent_model_reasoning_level::Column::AgentModelId.eq(model_id))
            .filter(agent_model_reasoning_level::Column::ReasoningLevelId.eq(reasoning_id))
            .one(self.database)
            .await?
            .is_some();
        let row = if compatible {
            reasoning_level::Entity::find_by_id(reasoning_id)
                .one(self.database)
                .await?
        } else {
            None
        };
        row.map(|value| value.name)
            .ok_or_else(|| {
                rejected(
                    "unsupported_reasoning",
                    "Reasoning is not permitted for the selected model.",
                )
            })
            .map(Some)
    }

    async fn global_default(&self) -> Result<Option<GlobalLaunchDefault>, LaunchPolicyError> {
        Ok(read_global_launch_default(self.database).await?)
    }
}

fn require_activated(provider: &provider::Model) -> Result<(), LaunchPolicyError> {
    if provider.activated {
        return Ok(());
    }
    Err(rejected(
        "provider_not_activated",
        format!("Agent/provider '{}' is not activated.", provider.slug),
    ))
}

fn rejected(code: &'static str, message: impl Into<String>) -> LaunchPolicyError {
    LaunchPolicyError::rejected(code, message)
}

struct ModelRow {
    id: String,
    name: String,
    provider_slug: String,
}

fn model_row(row: Option<(agent_model::Model, Option<provider::Model>)>) -> Option<ModelRow> {
    let (model, provider) = row?;
    let provider = provider?;
    Some(ModelRow {
        id: model.id,
        name: model.name,
        provider_slug: provider.slug,
    })
}
