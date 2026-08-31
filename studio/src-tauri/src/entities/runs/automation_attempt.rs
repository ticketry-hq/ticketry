use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "automation_attempts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub transition_id: String,
    pub issue_id: String,
    pub from_state_id: String,
    pub to_state_id: String,
    pub workflow_revision: i32,
    pub status: String,
    pub agent: Option<String>,
    pub agent_run_id: Option<String>,
    pub error: Option<String>,
    pub error_details: Option<String>,
    pub retryable: bool,
    pub dismissed_at: Option<String>,
    pub retry_of_id: Option<String>,
    pub root_attempt_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<crate::entities::work_management::issue::Entity>,
    #[sea_orm(
        self_ref,
        relation_enum = "RetryOf",
        relation_reverse = "RetryAttempts",
        from = "retry_of_id",
        to = "id"
    )]
    pub retry_of: BelongsTo<Option<Entity>>,
    #[sea_orm(
        self_ref,
        relation_enum = "RetryAttempts",
        relation_reverse = "RetryOf"
    )]
    pub retry_attempts: HasMany<Entity>,
    #[sea_orm(
        self_ref,
        relation_enum = "RootAttempt",
        relation_reverse = "RetryDescendants",
        from = "root_attempt_id",
        to = "id"
    )]
    pub root_attempt: BelongsTo<Option<Entity>>,
    #[sea_orm(
        self_ref,
        relation_enum = "RetryDescendants",
        relation_reverse = "RootAttempt"
    )]
    pub retry_descendants: HasMany<Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
