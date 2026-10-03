use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_executions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[seaography(ignore)]
    pub client_request_id: String,
    pub agent_run_id: String,
    pub sprint_id: String,
    pub output_type: String,
    #[seaography(ignore)]
    pub input_snapshot: String,
    pub goals_revision: Option<DateTime>,
    pub state: String,
    pub error: Option<String>,
    pub cancel_requested: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "id")]
    pub agent_run: BelongsTo<crate::runs::agent_run::Entity>,
    #[sea_orm(belongs_to, from = "sprint_id", to = "id")]
    pub sprint: BelongsTo<crate::work_management::sprint::Entity>,
}
impl ActiveModelBehavior for ActiveModel {}
