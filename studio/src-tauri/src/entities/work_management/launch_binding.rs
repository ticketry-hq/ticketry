use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_launchbinding")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub issue_type_id: String,
    pub state_id: String,
    pub prompt: String,
    pub required_skills: Json,
    /// The one skill a launch enters through, or none.
    ///
    /// Nullable, and when present it names a skill the binding already
    /// requires. The stored value is the bare skill slug: provider prefix
    /// characters belong to the command a launch builds, not to this row.
    pub entry_skill: Option<String>,
    pub model_id: Option<String>,
    pub reasoning_id: Option<String>,
    pub auto_start: bool,
    pub subtree_run_enabled: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "issue_type_id", to = "id")]
    pub issue_type: BelongsTo<super::issue_type::Entity>,
    #[sea_orm(belongs_to, from = "state_id", to = "id")]
    pub state: BelongsTo<super::state::Entity>,
    #[sea_orm(belongs_to, from = "model_id", to = "id")]
    pub agent_model: BelongsTo<Option<super::agent_model::Entity>>,
    #[sea_orm(belongs_to, from = "reasoning_id", to = "id")]
    pub reasoning: BelongsTo<Option<super::reasoning_level::Entity>>,
}

impl ActiveModelBehavior for ActiveModel {}
