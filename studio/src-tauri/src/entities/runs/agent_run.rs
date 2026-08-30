use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub issue_id: String,
    pub ticket_seq: Option<i32>,
    pub agent: Option<String>,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    #[seaography(ignore)]
    pub cwd: Option<String>,
    pub provider_session_id: Option<String>,
    pub lifecycle_state: Option<String>,
    pub lifecycle_updated_at: Option<String>,
    #[seaography(ignore)]
    pub design_dir: Option<String>,
    pub resumed_from: Option<String>,
    pub scope: String,
    pub launch_state: Option<String>,
    pub launch_model: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub initial_prompt: Option<String>,
    pub launch_reasoning: Option<String>,
    pub launch_unattended: bool,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<crate::work_management::entities::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
