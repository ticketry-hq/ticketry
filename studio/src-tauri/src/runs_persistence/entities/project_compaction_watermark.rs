use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "runs_project_compaction_watermarks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub project_id: String,
    pub compacted_through_cursor: i64,
    pub updated_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
