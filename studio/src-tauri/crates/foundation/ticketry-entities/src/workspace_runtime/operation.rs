use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "workspace_operations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub operation_id: String,
    pub kind: String,
    pub intent_version: i32,
    pub resource_kind: String,
    pub resource_key: String,
    pub intent: String,
    pub intent_fingerprint: String,
    pub state: String,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub attempt_count: i32,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub evidence: Option<String>,
    pub result_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub settled_at: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
