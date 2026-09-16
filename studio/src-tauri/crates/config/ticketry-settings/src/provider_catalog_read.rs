use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, EntityTrait, QueryOrder};

use super::entities::app_settings as app_setting;
use super::global_launch_default::read_global_launch_default;
use super::global_launch_default::{PROVIDER_CATALOG_KEY, PROVIDER_CATALOG_SCOPE};
use super::provider_catalog::{normalized_profiles, ProviderCatalog, ProviderCatalogError};
use sea_orm::{ColumnTrait, QueryFilter};
use ticketry_entities::{agent_model, provider, reasoning_level, StringList};
use ticketry_provider::{provider_contract, Provider};

pub(super) async fn load_from(
    database: &impl ConnectionTrait,
) -> Result<ProviderCatalog, ProviderCatalogError> {
    let provider_rows = provider::Entity::find()
        .order_by_asc(provider::Column::Slug)
        .all(database)
        .await?;
    let mut model_rows = agent_model::Entity::find().all(database).await?;
    let provider_slugs = provider_rows
        .iter()
        .map(|row| (row.id.as_str(), row.slug.as_str()))
        .collect::<BTreeMap<_, _>>();
    model_rows.sort_by(|left, right| {
        provider_slugs
            .get(left.provider_id.as_str())
            .cmp(&provider_slugs.get(right.provider_id.as_str()))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    let reasoning_rows = reasoning_level::Entity::find()
        .order_by_asc(reasoning_level::Column::Name)
        .order_by_asc(reasoning_level::Column::Id)
        .all(database)
        .await?;
    Ok(ProviderCatalog {
        configurable_providers: provider_rows
            .iter()
            .filter(|row| {
                Provider::from_slug(&row.slug).is_some_and(|provider| {
                    provider_contract(provider).metadata().settings_configurable
                })
            })
            .cloned()
            .collect(),
        providers: provider_rows
            .iter()
            .filter(|row| row.activated)
            .cloned()
            .collect(),
        agent_models: model_rows,
        reasoning_levels: reasoning_rows,
        codex_profiles: StringList(normalized_profiles(
            app_setting::Entity::find()
                .filter(app_setting::Column::Scope.eq(PROVIDER_CATALOG_SCOPE))
                .filter(app_setting::Column::Key.eq(PROVIDER_CATALOG_KEY))
                .one(database)
                .await?
                .and_then(|row| serde_json::from_str::<serde_json::Value>(&row.value).ok())
                .and_then(|value| value.get("codex_profiles")?.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect(),
        )?),
        global_default: read_global_launch_default(database).await?,
    })
}
