use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issue")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub r#type: String,
    pub issue_type_id: String,
    pub parent_id: Option<String>,
    pub module_id: Option<String>,
    pub state_id: Option<String>,
    pub state_revision: i64,
    pub name: String,
    pub sequence_id: i32,
    pub is_archived: bool,
    pub rank: String,
    pub description: String,
    pub workspace_tab_order: Json,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "issue_type_id", to = "id")]
    pub issue_type: BelongsTo<super::issue_type::Entity>,
    #[sea_orm(belongs_to, from = "state_id", to = "id")]
    pub state: BelongsTo<Option<super::state::Entity>>,
    #[sea_orm(
        self_ref,
        relation_enum = "Parent",
        relation_reverse = "Children",
        from = "parent_id",
        to = "id"
    )]
    pub parent: BelongsTo<Option<Entity>>,
    #[sea_orm(self_ref, relation_enum = "Children", relation_reverse = "Parent")]
    pub children: HasMany<Entity>,
    #[sea_orm(
        self_ref,
        relation_enum = "Module",
        relation_reverse = "ModuleMembers",
        from = "module_id",
        to = "id"
    )]
    pub module: BelongsTo<Option<Entity>>,
    #[sea_orm(self_ref, relation_enum = "ModuleMembers", relation_reverse = "Module")]
    pub module_members: HasMany<Entity>,
    #[sea_orm(has_many, relation_enum = "BlockedByEdges", via_rel = "BlockedIssue")]
    pub blocked_by_edges: HasMany<super::issue_blocker::Entity>,
    #[sea_orm(has_many, relation_enum = "BlocksEdges", via_rel = "BlockingIssue")]
    pub blocks_edges: HasMany<super::issue_blocker::Entity>,
    #[sea_orm(has_many, relation_enum = "AgentRuns")]
    pub agent_runs: HasMany<crate::entities::runs::agent_run::Entity>,
    #[sea_orm(has_many)]
    pub attachments: HasMany<super::attachment::Entity>,
    #[sea_orm(has_one, relation_enum = "Presentation", relation_reverse = "Module")]
    pub presentation: HasOne<super::module_presentation::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
