use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_run_viewer_leases")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub agent_run_id: String,
    pub viewer_id: String,
    pub transport: String,
    pub generation: String,
    pub acquired_at: String,
    pub expires_at: String,
    #[sea_orm(belongs_to, from = "agent_run_id", to = "id")]
    pub agent_run: BelongsTo<crate::entities::runs::agent_run::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
