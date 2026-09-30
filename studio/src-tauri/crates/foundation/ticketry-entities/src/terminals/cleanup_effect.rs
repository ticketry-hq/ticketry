use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "terminal_cleanup_effects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub effect_id: String,
    pub agent_run_id: String,
    pub cause: String,
    pub state: String,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub attempt_count: i32,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub runtime_evidence: Option<Json>,
    pub created_at: String,
    pub updated_at: String,
    pub applied_at: Option<String>,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "agent_run_id")]
    pub terminal_session: BelongsTo<super::session::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
