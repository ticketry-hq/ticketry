use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_provider")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub slug: String,
    pub activated: bool,
    pub supports_unattended: bool,
    #[sea_orm(has_many)]
    pub agent_models: HasMany<super::agent_model::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
