//! 0055: the Codex catalog seeded Astra as `gpt-5.6-astra`, but the Codex CLI
//! only knows the model as `gpt-6-astra`, so every launch failed on `--model`.
//! Rename the row in place so launch bindings keep their model id.

use sea_orm::{ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, Set};

use ticketry_entities::agent_model;

pub(super) const REQUIRED_TABLES: &[&str] = &["worktracker_provider", "worktracker_agentmodel"];

pub(super) const OLD_NAME: &str = "gpt-5.6-astra";
pub(super) const NEW_NAME: &str = "gpt-6-astra";

pub(super) async fn apply(
    transaction: &DatabaseTransaction,
    provider_id: &str,
) -> Result<(), DbErr> {
    let Some(stale) = agent_model::Entity::find()
        .filter(agent_model::Column::ProviderId.eq(provider_id))
        .filter(agent_model::Column::Name.eq(OLD_NAME))
        .one(transaction)
        .await?
    else {
        return Ok(());
    };
    let already_renamed = agent_model::Entity::find()
        .filter(agent_model::Column::ProviderId.eq(provider_id))
        .filter(agent_model::Column::Name.eq(NEW_NAME))
        .one(transaction)
        .await?
        .is_some();
    if already_renamed {
        return Ok(());
    }
    agent_model::Entity::update(agent_model::ActiveModel {
        id: Set(stale.id),
        provider_id: Set(stale.provider_id),
        name: Set(NEW_NAME.to_owned()),
    })
    .exec(transaction)
    .await?;
    Ok(())
}
