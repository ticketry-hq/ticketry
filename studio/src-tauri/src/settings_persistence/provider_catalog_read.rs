use std::collections::BTreeMap;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

use super::entities::app_setting;
use super::provider_catalog::{
    GlobalLaunchDefault, ProviderCatalog, ProviderCatalogError, CONFIGURABLE_PROVIDER_SLUGS,
    PROVIDER_CATALOG_KEY, PROVIDER_CATALOG_SCOPE,
};
use crate::work_management::entities::{
    agent_model, agent_model_reasoning_level, provider, reasoning_level,
};
use crate::work_management::read_types::{AgentModel, Provider, ReasoningLevel, StringList};

pub(super) type ProviderRow = provider::Model;

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
    let reasoning_order = reasoning_rows
        .iter()
        .enumerate()
        .map(|(index, row)| (row.id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut compatibility_rows = agent_model_reasoning_level::Entity::find()
        .all(database)
        .await?;
    compatibility_rows.sort_by_key(|row| {
        (
            reasoning_order
                .get(row.reasoning_level_id.as_str())
                .copied()
                .unwrap_or(usize::MAX),
            row.id,
        )
    });

    let mut compatibility = BTreeMap::<&str, Vec<String>>::new();
    for link in &compatibility_rows {
        compatibility
            .entry(link.agent_model_id.as_str())
            .or_default()
            .push(uuid(&link.reasoning_level_id));
    }
    let provider = |row: &ProviderRow| Provider {
        id: uuid(&row.id),
        slug: row.slug.clone(),
        activated: row.activated,
        supports_unattended: row.supports_unattended,
    };
    Ok(ProviderCatalog {
        configurable_providers: provider_rows
            .iter()
            .filter(|row| CONFIGURABLE_PROVIDER_SLUGS.contains(&row.slug.as_str()))
            .map(provider)
            .collect(),
        providers: provider_rows
            .iter()
            .filter(|row| row.activated)
            .map(provider)
            .collect(),
        agent_models: model_rows
            .into_iter()
            .map(|row| AgentModel {
                id: uuid(&row.id),
                provider: uuid(&row.provider_id),
                name: row.name,
                permitted_reasoning_levels: StringList(
                    compatibility.remove(row.id.as_str()).unwrap_or_default(),
                ),
            })
            .collect(),
        reasoning_levels: reasoning_rows
            .into_iter()
            .map(|row| ReasoningLevel {
                id: uuid(&row.id),
                name: row.name,
            })
            .collect(),
        global_default: read_global_default(database).await?,
    })
}

async fn read_global_default(
    database: &impl ConnectionTrait,
) -> Result<Option<GlobalLaunchDefault>, ProviderCatalogError> {
    let row = app_setting::Entity::find()
        .filter(app_setting::Column::Scope.eq(PROVIDER_CATALOG_SCOPE))
        .filter(app_setting::Column::Key.eq(PROVIDER_CATALOG_KEY))
        .one(database)
        .await?;
    let Some(value) = row else {
        return Ok(None);
    };
    Ok(salvage_default(&value.value))
}

fn salvage_default(value: &str) -> Option<GlobalLaunchDefault> {
    let document = serde_json::from_str::<serde_json::Value>(value).ok()?;
    let raw = document.as_object()?.get("global_default")?;
    if raw.is_null() {
        return None;
    }
    let object = raw.as_object()?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "provider" | "model" | "reasoning"))
    {
        return None;
    }
    let provider = object.get("provider")?.as_str()?.trim().to_owned();
    if provider.is_empty() {
        return None;
    }
    let optional = |field: &str| match object.get(field) {
        None | Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(value)) => {
            let value = value.trim();
            Some((!value.is_empty()).then(|| value.to_owned()))
        }
        Some(_) => None,
    };
    Some(GlobalLaunchDefault {
        provider,
        model: optional("model")?,
        reasoning: optional("reasoning")?,
    })
}

fn uuid(value: &str) -> String {
    let compact = value.replace('-', "");
    if compact.len() != 32
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return value.to_owned();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..12],
        &compact[12..16],
        &compact[16..20],
        &compact[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_and_unknown_fields_salvage_to_no_default() {
        assert_eq!(salvage_default("not json"), None);
        assert_eq!(salvage_default("[]"), None);
        assert_eq!(
            salvage_default(r#"{"global_default":{"provider":"codex","future":true}}"#),
            None
        );
    }

    #[test]
    fn legacy_outer_fields_are_ignored_while_the_default_is_normalized() {
        assert_eq!(
            salvage_default(
                r#"{"activated_providers":["claude"],"future":true,"global_default":{"provider":" codex ","model":" gpt-5.4 ","reasoning":" "}}"#
            ),
            Some(GlobalLaunchDefault {
                provider: "codex".to_owned(),
                model: Some("gpt-5.4".to_owned()),
                reasoning: None,
            })
        );
    }
}
