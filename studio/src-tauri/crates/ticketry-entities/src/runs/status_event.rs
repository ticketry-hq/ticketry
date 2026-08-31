use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "runs_status_events")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub cursor: i64,
    pub event_id: String,
    pub project_id: String,
    pub event_kind: String,
    pub payload_version: i32,
    pub subject_kind: String,
    pub subject_id: String,
    pub agent_run_id: Option<String>,
    pub automation_attempt_id: Option<String>,
    pub work_item_id: Option<String>,
    pub payload: String,
    pub committed_at: String,
}

impl ActiveModelBehavior for ActiveModel {}
