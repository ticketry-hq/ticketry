//! Reconcile model rows and their exact ordered reasoning-level set.

use sea_orm::{
    ActiveValue::NotSet, ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, Set,
};

use ticketry_entities::{agent_model, agent_model_reasoning_level, reasoning_level};

pub(super) async fn apply_model(
    transaction: &DatabaseTransaction,
    provider_id: &str,
    name: &str,
    reasoning_names: &[&str],
) -> Result<(), DbErr> {
    let model_id = model_id(transaction, provider_id, name).await?;
    let mut reasoning_ids = Vec::with_capacity(reasoning_names.len());
    for name in reasoning_names {
        reasoning_ids.push(reasoning_id(transaction, name).await?);
    }
    let stale = agent_model_reasoning_level::Entity::delete_many()
        .filter(agent_model_reasoning_level::Column::AgentModelId.eq(&model_id));
    let stale = if reasoning_ids.is_empty() {
        stale
    } else {
        stale.filter(
            agent_model_reasoning_level::Column::ReasoningLevelId.is_not_in(reasoning_ids.clone()),
        )
    };
    stale.exec(transaction).await?;
    for reasoning_level_id in reasoning_ids {
        let exists = agent_model_reasoning_level::Entity::find()
            .filter(agent_model_reasoning_level::Column::AgentModelId.eq(&model_id))
            .filter(agent_model_reasoning_level::Column::ReasoningLevelId.eq(&reasoning_level_id))
            .one(transaction)
            .await?
            .is_some();
        if !exists {
            agent_model_reasoning_level::Entity::insert(agent_model_reasoning_level::ActiveModel {
                id: NotSet,
                agent_model_id: Set(model_id.clone()),
                reasoning_level_id: Set(reasoning_level_id),
            })
            .exec(transaction)
            .await?;
        }
    }
    Ok(())
}

async fn model_id(
    database: &DatabaseTransaction,
    provider_id: &str,
    name: &str,
) -> Result<String, DbErr> {
    if let Some(model) = agent_model::Entity::find()
        .filter(agent_model::Column::ProviderId.eq(provider_id))
        .filter(agent_model::Column::Name.eq(name))
        .one(database)
        .await?
    {
        return Ok(model.id);
    }
    let id = new_id();
    agent_model::Entity::insert(agent_model::ActiveModel {
        id: Set(id.clone()),
        provider_id: Set(provider_id.to_owned()),
        name: Set(name.to_owned()),
    })
    .exec(database)
    .await?;
    Ok(id)
}

async fn reasoning_id(database: &DatabaseTransaction, name: &str) -> Result<String, DbErr> {
    if let Some(reasoning) = reasoning_level::Entity::find()
        .filter(reasoning_level::Column::Name.eq(name))
        .one(database)
        .await?
    {
        return Ok(reasoning.id);
    }
    let id = new_id();
    reasoning_level::Entity::insert(reasoning_level::ActiveModel {
        id: Set(id.clone()),
        name: Set(name.to_owned()),
    })
    .exec(database)
    .await?;
    Ok(id)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
