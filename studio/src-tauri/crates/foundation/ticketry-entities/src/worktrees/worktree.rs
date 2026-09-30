use sea_orm::entity::prelude::*;

/// The durable index row for one top-level Work Item's Git worktree.
///
/// Git remains authoritative for the checkout, branch tip, clean/dirty state,
/// and ahead/behind counts. This row only records the derived identity needed
/// to re-attach a checkout to its Work Item across restart, which is why the
/// live status fields are absent from the table.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktrees")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub task_id: String,
    pub workspace_slug: Option<String>,
    pub project_id: Option<String>,
    pub module_id: Option<String>,
    pub ticket_seq: Option<i32>,
    pub repo_root: String,
    pub path: String,
    pub branch: String,
    pub base_branch: String,
    pub base_commit: String,
    pub status: String,
    pub ephemeral: bool,
    pub created_at: String,
    pub updated_at: String,
    pub pull_request_url: Option<String>,
    #[sea_orm(belongs_to, from = "task_id", to = "id")]
    pub task: BelongsTo<crate::work_management::issue::Entity>,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<Option<crate::work_management::project::Entity>>,
}

impl ActiveModelBehavior for ActiveModel {}
