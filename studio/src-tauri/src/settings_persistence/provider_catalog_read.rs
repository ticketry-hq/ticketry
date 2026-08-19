use std::collections::BTreeMap;

use sea_orm::{ConnectionTrait, EntityTrait, QueryOrder};

use super::global_launch_default::read_global_launch_default;
use super::provider_catalog::{ProviderCatalog, ProviderCatalogError, CONFIGURABLE_PROVIDER_SLUGS};
use crate::work_management::entities::{agent_model, provider, reasoning_level};

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
            .filter(|row| CONFIGURABLE_PROVIDER_SLUGS.contains(&row.slug.as_str()))
            .cloned()
            .collect(),
        providers: provider_rows
            .iter()
            .filter(|row| row.activated)
            .cloned()
            .collect(),
        agent_models: model_rows,
        reasoning_levels: reasoning_rows,
        global_default: read_global_launch_default(database).await?,
    })
}
