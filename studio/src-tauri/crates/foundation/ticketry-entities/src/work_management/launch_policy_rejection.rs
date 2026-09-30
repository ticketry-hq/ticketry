use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ticketry_launchpolicyrejection")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub caller_scope: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub idempotency_key: String,
    pub code: String,
    pub message: String,
    #[sea_orm(default_expr = "Expr::current_timestamp()")]
    pub rejected_at: DateTime,
}

impl ActiveModelBehavior for ActiveModel {}
