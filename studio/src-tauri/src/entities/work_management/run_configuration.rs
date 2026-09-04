use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_runconfiguration")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub module_id: String,
    pub command: String,
    pub environment: Json,
    pub preview_url: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "module_id", to = "id")]
    pub module: BelongsTo<super::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
