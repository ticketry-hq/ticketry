use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issuetype")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub level: String,
    pub color: String,
    pub sort_order: i32,
    pub start_state_id: Option<String>,
    pub workflow_revision: i32,
    pub is_pathfind: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "start_state_id", to = "id")]
    pub start_state: BelongsTo<Option<super::state::Entity>>,
    #[sea_orm(has_many)]
    pub issues: HasMany<super::issue::Entity>,
    #[sea_orm(has_many)]
    pub transitions: HasMany<super::issue_type_transition::Entity>,
    #[sea_orm(has_many)]
    pub launch_bindings: HasMany<super::launch_binding::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
