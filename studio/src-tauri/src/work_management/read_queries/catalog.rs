use std::collections::HashMap;

use sea_orm::{DatabaseConnection, DbErr, EntityTrait, QueryOrder};

use super::uuid;
use crate::work_management::{
    entities::{agent_model, agent_model_reasoning_level, provider, reasoning_level},
    read_types as output,
};

pub async fn providers(database: &DatabaseConnection) -> Result<Vec<output::Provider>, DbErr> {
    Ok(provider::Entity::find()
        .order_by_asc(provider::Column::Slug)
        .all(database)
        .await?
        .into_iter()
        .map(|row| output::Provider {
            id: uuid(&row.id),
            slug: row.slug,
            activated: row.activated,
            supports_unattended: row.supports_unattended,
        })
        .collect())
}

pub async fn reasoning_levels(
    database: &DatabaseConnection,
) -> Result<Vec<output::ReasoningLevel>, DbErr> {
    Ok(reasoning_level::Entity::find()
        .order_by_asc(reasoning_level::Column::Name)
        .all(database)
        .await?
        .into_iter()
        .map(|row| output::ReasoningLevel {
            id: uuid(&row.id),
            name: row.name,
        })
        .collect())
}

pub async fn agent_models(database: &DatabaseConnection) -> Result<Vec<output::AgentModel>, DbErr> {
    let providers: HashMap<String, String> = provider::Entity::find()
        .all(database)
        .await?
        .into_iter()
        .map(|row| (row.id, row.slug))
        .collect();
    let relations = agent_model_reasoning_level::Entity::find()
        .all(database)
        .await?;
    let mut rows = agent_model::Entity::find().all(database).await?;
    rows.sort_by_key(|row| {
        (
            providers.get(&row.provider_id).cloned().unwrap_or_default(),
            row.name.clone(),
        )
    });
    Ok(rows
        .into_iter()
        .map(|row| output::AgentModel {
            id: uuid(&row.id),
            provider: uuid(&row.provider_id),
            name: row.name,
            permitted_reasoning_levels: output::StringList(
                relations
                    .iter()
                    .filter(|relation| relation.agent_model_id == row.id)
                    .map(|relation| uuid(&relation.reasoning_level_id))
                    .collect(),
            ),
        })
        .collect())
}
