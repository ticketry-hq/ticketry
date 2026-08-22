use sea_orm::entity::prelude::*;

use crate::work_management::entities::{issue, project};

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "graph_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub root_id: String,
    pub agent: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    pub module_id: Option<String>,
    pub project_id: String,
    pub execution_mode: String,
    #[seaography(ignore)]
    pub launch_configuration: Option<String>,
    #[sea_orm(belongs_to, relation_enum = "Root", from = "root_id", to = "id")]
    pub root: BelongsTo<issue::Entity>,
    #[sea_orm(belongs_to, relation_enum = "Module", from = "module_id", to = "id")]
    pub module: BelongsTo<Option<issue::Entity>>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<project::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
