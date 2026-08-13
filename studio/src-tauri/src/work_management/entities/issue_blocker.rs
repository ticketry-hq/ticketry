use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issue_blocked_by")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub from_issue_id: String,
    pub to_issue_id: String,
    #[sea_orm(
        belongs_to,
        relation_enum = "BlockedIssue",
        from = "from_issue_id",
        to = "id"
    )]
    pub blocked_issue: BelongsTo<super::issue::Entity>,
    #[sea_orm(
        belongs_to,
        relation_enum = "BlockingIssue",
        from = "to_issue_id",
        to = "id"
    )]
    pub blocking_issue: BelongsTo<super::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
