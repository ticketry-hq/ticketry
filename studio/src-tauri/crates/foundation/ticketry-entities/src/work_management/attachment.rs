use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_attachment")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub issue_id: String,
    pub file: String,
    pub filename: String,
    pub mime_type: String,
    pub size: Option<i32>,
    pub created_at: DateTime,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<super::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
