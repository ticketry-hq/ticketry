use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_terminal_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub agent_run_id: String,
    #[seaography(ignore)]
    pub tmux_session_name: String,
    pub task_id: String,
    pub module_id: String,
    pub project_id: String,
    pub created_at: String,
    pub terminated_at: Option<String>,
    pub scope: String,
    pub doc_rel_path: Option<String>,
    #[seaography(ignore)]
    pub runtime_cleanup_pending: bool,
    #[seaography(ignore)]
    pub runtime_namespace: Option<String>,
    #[seaography(ignore)]
    pub output_identity: Option<String>,
    #[seaography(ignore)]
    pub output_sequence: i64,
    #[seaography(ignore)]
    pub last_output_at: Option<String>,
    pub agent: Option<String>,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "id")]
    pub agent_run: BelongsTo<crate::runs::agent_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
