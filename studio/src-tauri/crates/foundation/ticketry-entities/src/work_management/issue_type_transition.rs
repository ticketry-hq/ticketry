use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issuetypetransition")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub issue_type_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub agent_allowed: bool,
    pub handoff: bool,
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
