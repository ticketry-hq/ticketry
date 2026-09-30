use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ticketry_launchpolicydecision")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub decision_id: String,
    pub version: i32,
    #[sea_orm(unique_key = "scope_idempotency")]
    pub caller_scope: String,
    #[sea_orm(unique_key = "scope_idempotency")]
    pub idempotency_key: String,
    pub decision_json: String,
    #[sea_orm(default_expr = "Expr::current_timestamp()")]
    pub created_at: DateTime,
    pub delivered_at: Option<DateTime>,
}

impl ActiveModelBehavior for ActiveModel {}
