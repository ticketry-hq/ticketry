use sea_orm::{ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter};

use ticketry_entities::provider;

pub(super) const MODEL_NAME: &str = "glm-5.3-flash";

pub(super) async fn apply(transaction: &DatabaseTransaction) -> Result<(), DbErr> {
    let codex = provider::Entity::find()
        .filter(provider::Column::Slug.eq("codex"))
        .one(transaction)
        .await?
        .ok_or_else(|| DbErr::Custom("the provider catalog has no codex provider".to_owned()))?;
    super::codex_5_6::apply_model(transaction, &codex.id, MODEL_NAME, &[]).await
}
