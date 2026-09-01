use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_project")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub seq_counter: i32,
    pub state_revision: i64,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    pub onboarding_required: bool,
    #[sea_orm(has_many)]
    pub states: HasMany<super::state::Entity>,
    #[sea_orm(has_many)]
    pub issue_types: HasMany<super::issue_type::Entity>,
    #[sea_orm(has_many)]
    pub issues: HasMany<super::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
