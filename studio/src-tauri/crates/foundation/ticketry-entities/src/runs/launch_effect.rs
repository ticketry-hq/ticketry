use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "runs_launch_effects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub effect_id: String,
    pub intent_version: i32,
    pub agent_run_id: String,
    pub automation_attempt_id: Option<String>,
    pub request_id: String,
    pub project_id: String,
    pub issue_id: String,
    pub scope: String,
    pub provider: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    pub policy_reference: Option<String>,
    pub state: String,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub attempt_count: i32,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub runtime_evidence: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub applied_at: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
