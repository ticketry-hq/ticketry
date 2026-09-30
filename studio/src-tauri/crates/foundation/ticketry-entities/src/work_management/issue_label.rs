use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issue_labels")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub issue_id: String,
    pub label_id: String,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<super::issue::Entity>,
    #[sea_orm(belongs_to, from = "label_id", to = "id")]
    pub label: BelongsTo<super::label::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
