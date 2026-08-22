use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "launched_tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub task_id: String,
    #[sea_orm(unique)]
    #[seaography(ignore)]
    pub claim_id: String,
    #[seaography(ignore)]
    pub agent_run_id: String,
    #[sea_orm(unique)]
    #[seaography(ignore)]
    pub launch_effect_id: String,
    pub launch_generation: i64,
    pub launched_at: DateTime,
    pub root_id: String,
    #[sea_orm(belongs_to, from = "task_id", to = "id")]
    pub task: BelongsTo<crate::work_management::entities::issue::Entity>,
    #[sea_orm(belongs_to, from = "root_id", to = "root_id")]
    pub graph_run: BelongsTo<super::graph_run::Entity>,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "id")]
    pub agent_run: BelongsTo<crate::entities::runs::agent_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
