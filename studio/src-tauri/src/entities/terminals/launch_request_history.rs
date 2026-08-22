use sea_orm::entity::prelude::*;

/// Imported Python execution material. Rust retains it as inert history and
/// never treats a row here as launch intent.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "terminal_launch_requests")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub effect_id: String,
    pub agent_run_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub module_id: String,
    pub task_id: String,
    pub scope: String,
    pub doc_rel_path: Option<String>,
    pub command: String,
    pub working_directory: String,
    pub environment: Json,
    pub columns: i32,
    pub rows: i32,
    pub created_at: String,
    pub agent: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
