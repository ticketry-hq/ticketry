use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_modulepresentation")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub module_id: String,
    pub rank: String,
    pub tab_hidden: bool,
    #[sea_orm(
        belongs_to,
        relation_enum = "Module",
        relation_reverse = "Presentation",
        from = "module_id",
        to = "id"
    )]
    pub module: BelongsTo<super::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
