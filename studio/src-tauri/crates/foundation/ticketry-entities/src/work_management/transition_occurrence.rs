use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_transitionoccurrence")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub occurrence_id: String,
    pub version: i32,
    pub issue_id: String,
    pub project_id: String,
    pub issue_type_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub from_group: String,
    pub to_group: String,
    pub work_item_revision: i64,
    pub workflow_revision: i32,
    pub destination_auto_start: bool,
    pub handoff: bool,
    pub run_now_decision_id: Option<String>,
    #[sea_orm(default_expr = "Expr::current_timestamp()")]
    pub committed_at: DateTime,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<super::issue::Entity>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "issue_type_id", to = "id")]
    pub issue_type: BelongsTo<super::issue_type::Entity>,
    #[sea_orm(
        belongs_to,
        relation_enum = "FromState",
        from = "from_state_id",
        to = "id"
    )]
    pub from_state: BelongsTo<super::state::Entity>,
    #[sea_orm(belongs_to, relation_enum = "ToState", from = "to_state_id", to = "id")]
    pub to_state: BelongsTo<super::state::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
