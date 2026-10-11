use sea_orm::entity::prelude::*;

/// One durable receipt for one source-control action, keyed by the
/// caller-supplied operation id.
///
/// Action facts are append-only: the database allows PR state and refresh time
/// to move from open to a terminal merged or closed verdict and nothing else.
/// Raw Git and provider output never reaches this table.
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "ticketry_shiprecords")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub module_id: String,
    pub task_id: Option<String>,
    pub checkout_kind: String,
    pub checkout_label: String,
    pub operation_id: String,
    pub branch: String,
    pub commit_shas: Json,
    pub steps: Json,
    pub acted_at: String,
    pub pr_url: Option<String>,
    pub pr_number: Option<i32>,
    pub pr_state: Option<String>,
    pub pr_target_branch: Option<String>,
    pub pr_head_commit: Option<String>,
    pub pr_refreshed_at: Option<String>,
    #[sea_orm(belongs_to, from = "module_id", to = "id")]
    pub module: BelongsTo<crate::work_management::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
