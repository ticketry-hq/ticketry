use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_agentmodel")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub provider_id: String,
    pub name: String,
    #[sea_orm(belongs_to, from = "provider_id", to = "id")]
    pub provider: BelongsTo<super::provider::Entity>,
    #[sea_orm(has_many)]
    pub launch_bindings: HasMany<super::launch_binding::Entity>,
    #[sea_orm(has_many)]
    pub reasoning_levels: HasMany<super::agent_model_reasoning_level::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
