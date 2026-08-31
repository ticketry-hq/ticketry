use sea_orm::{
    ActiveValue::NotSet, ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, Set,
};

use ticketry_entities::work_management::{
    agent_model, agent_model_reasoning_level, provider, reasoning_level,
};

const MODELS: &[(&str, &[&str])] = &[
    (
        "gpt-5.6-sol",
        &["low", "medium", "high", "xhigh", "max", "ultra"],
    ),
    (
        "gpt-5.6-terra",
        &["low", "medium", "high", "xhigh", "max", "ultra"],
    ),
    ("gpt-5.6-luna", &["low", "medium", "high", "xhigh", "max"]),
];

pub(super) async fn apply(transaction: &DatabaseTransaction) -> Result<(), DbErr> {
    let codex = provider::Entity::find()
        .filter(provider::Column::Slug.eq("codex"))
        .one(transaction)
        .await?
        .ok_or_else(|| DbErr::Custom("the provider catalog has no codex provider".to_owned()))?;

    for (name, reasoning_names) in MODELS {
        let model_id = model_id(transaction, &codex.id, name).await?;
        let mut reasoning_ids = Vec::with_capacity(reasoning_names.len());
        for name in *reasoning_names {
            reasoning_ids.push(reasoning_id(transaction, name).await?);
        }
        agent_model_reasoning_level::Entity::delete_many()
            .filter(agent_model_reasoning_level::Column::AgentModelId.eq(&model_id))
            .filter(
                agent_model_reasoning_level::Column::ReasoningLevelId
                    .is_not_in(reasoning_ids.clone()),
            )
            .exec(transaction)
            .await?;
        for reasoning_level_id in reasoning_ids {
            let exists = agent_model_reasoning_level::Entity::find()
                .filter(agent_model_reasoning_level::Column::AgentModelId.eq(&model_id))
                .filter(
                    agent_model_reasoning_level::Column::ReasoningLevelId.eq(&reasoning_level_id),
                )
                .one(transaction)
                .await?
                .is_some();
            if !exists {
                agent_model_reasoning_level::Entity::insert(
                    agent_model_reasoning_level::ActiveModel {
                        id: NotSet,
                        agent_model_id: Set(model_id.clone()),
                        reasoning_level_id: Set(reasoning_level_id),
                    },
                )
                .exec(transaction)
                .await?;
            }
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
