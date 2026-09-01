use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_agentmodelreasoninglevel")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub agent_model_id: String,
    pub reasoning_level_id: String,
    #[sea_orm(belongs_to, from = "agent_model_id", to = "id")]
    pub agent_model: BelongsTo<super::agent_model::Entity>,
    #[sea_orm(belongs_to, from = "reasoning_level_id", to = "id")]
    pub reasoning_level: BelongsTo<super::reasoning_level::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
