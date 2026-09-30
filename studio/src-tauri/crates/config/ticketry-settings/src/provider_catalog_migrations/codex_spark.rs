use sea_orm::{ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, Set};

use ticketry_entities::{agent_model, agent_model_reasoning_level, provider};

pub(crate) const MODEL_NAME: &str = "gpt-5.3-codex-spark";

pub(super) async fn apply(transaction: &DatabaseTransaction) -> Result<(), DbErr> {
    let Some(codex) = provider::Entity::find()
        .filter(provider::Column::Slug.eq("codex"))
        .one(transaction)
        .await?
    else {
        return Ok(());
    };
    let model_id = if let Some(model) = agent_model::Entity::find()
        .filter(agent_model::Column::ProviderId.eq(&codex.id))
        .filter(agent_model::Column::Name.eq(MODEL_NAME))
        .one(transaction)
        .await?
    {
        model.id
    } else {
        let id = uuid::Uuid::new_v4().simple().to_string();
        agent_model::Entity::insert(agent_model::ActiveModel {
            id: Set(id.clone()),
            provider_id: Set(codex.id),
            name: Set(MODEL_NAME.to_owned()),
        })
        .exec(transaction)
        .await?;
        id
    };

    agent_model_reasoning_level::Entity::delete_many()
        .filter(agent_model_reasoning_level::Column::AgentModelId.eq(model_id))
        .exec(transaction)
        .await?;
    Ok(())
}
