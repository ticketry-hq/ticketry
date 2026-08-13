use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_reasoninglevel")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    #[sea_orm(has_many)]
    pub launch_bindings: HasMany<super::launch_binding::Entity>,
    #[sea_orm(has_many)]
    pub agent_models: HasMany<super::agent_model_reasoning_level::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
