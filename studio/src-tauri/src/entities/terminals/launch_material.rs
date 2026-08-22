use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "terminal_launch_material")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub effect_id: String,
    pub agent_run_id: String,
    pub schema_version: i32,
    pub request_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub module_id: String,
    pub task_id: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub scope: String,
    pub doc_rel_path: Option<String>,
    pub prompt: Option<String>,
    pub resume_from_agent_run_id: Option<String>,
    pub required_skills: Json,
    pub working_directory_identity: String,
    pub design_directory_identity: Option<String>,
    pub initial_columns: i32,
    pub initial_rows: i32,
    pub created_at: String,
    #[sea_orm(belongs_to, from = "effect_id", to = "effect_id")]
    pub launch_effect: BelongsTo<crate::entities::runs::launch_effect::Entity>,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "id")]
    pub agent_run: BelongsTo<crate::entities::runs::agent_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
