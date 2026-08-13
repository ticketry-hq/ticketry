use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_workspace")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub slug: String,
    pub name: String,
    pub onboarding_required: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(has_many)]
    pub projects: HasMany<super::project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
