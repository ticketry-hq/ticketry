use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue, Set, Unchanged};

pub const WAITING: &str = "waiting";
pub const ACCEPTED: &str = "accepted";
pub const DISMISSED: &str = "dismissed";

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_sprint_suggestion")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub sprint_id: String,
    pub goal_id: String,
    pub issue_id: Option<String>,
    pub proposed_name: Option<String>,
    pub proposed_epic_id: Option<String>,
    pub reason: String,
    pub status: String,
    pub run_id: String,
    pub created_at: DateTime,
    #[sea_orm(belongs_to, from = "sprint_id", to = "id")]
    pub sprint: BelongsTo<super::sprint::Entity>,
    #[sea_orm(belongs_to, relation_enum = "Goal", from = "goal_id", to = "id")]
    pub goal: BelongsTo<super::sprint_goal::Entity>,
    #[sea_orm(belongs_to, from = "issue_id", to = "id")]
    pub issue: BelongsTo<Option<super::issue::Entity>>,
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, database: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if insert {
            if self.id.is_not_set() {
                self.id = Set(uuid::Uuid::new_v4().simple().to_string());
            }
            if self.status.is_not_set() {
                self.status = Set(WAITING.to_owned());
            }
            if self.issue_id.is_not_set() {
                self.issue_id = Set(None);
            }
            if self.proposed_name.is_not_set() {
                self.proposed_name = Set(None);
            }
            if self.proposed_epic_id.is_not_set() {
                self.proposed_epic_id = Set(None);
            }
            if self.created_at.is_not_set() {
                self.created_at = Set(chrono::Utc::now().naive_utc());
            }
        } else {
            let id = required(&self.id, "id")?;
            let stored = Entity::find_by_id(id)
                .one(database)
                .await?
                .ok_or_else(|| DbErr::Custom("Suggestion not found.".into()))?;
            if self.sprint_id.is_not_set() {
                self.sprint_id = Unchanged(stored.sprint_id);
            }
            if self.goal_id.is_not_set() {
                self.goal_id = Unchanged(stored.goal_id);
            }
            if self.status.is_not_set() {
                self.status = Unchanged(stored.status);
            }
            if self.issue_id.is_not_set() {
                self.issue_id = Unchanged(stored.issue_id);
            }
            if self.proposed_name.is_not_set() {
                self.proposed_name = Unchanged(stored.proposed_name);
            }
            if self.proposed_epic_id.is_not_set() {
                self.proposed_epic_id = Unchanged(stored.proposed_epic_id);
            }
        }
        let status = required(&self.status, "status")?;
        if !matches!(status.as_str(), WAITING | ACCEPTED | DISMISSED) {
            return Err(DbErr::Custom(format!("status: Unknown status '{status}'.")));
        }
        let issue_id = optional(&self.issue_id);
        let proposed_name = optional(&self.proposed_name);
        if status == WAITING && issue_id.is_some() == proposed_name.is_some() {
            return Err(DbErr::Custom(
                "A waiting suggestion requires exactly one of issue_id or proposed_name.".into(),
            ));
        }
        let sprint_id = required(&self.sprint_id, "sprint_id")?;
        let sprint = super::sprint::Entity::find_by_id(&sprint_id)
            .one(database)
            .await?
            .ok_or_else(|| DbErr::Custom("Sprint not found.".into()))?;
        let goal_id = required(&self.goal_id, "goal_id")?;
        let goal = super::sprint_goal::Entity::find_by_id(goal_id)
            .one(database)
            .await?
            .ok_or_else(|| DbErr::Custom("Goal not found.".into()))?;
        if goal.sprint_id != sprint_id {
            return Err(DbErr::Custom(
                "The goal must belong to the suggestion's sprint.".into(),
            ));
        }
        for (field, id) in [
            ("issue_id", issue_id),
            ("proposed_epic_id", optional(&self.proposed_epic_id)),
        ] {
            if let Some(id) = id {
                let issue = super::issue::Entity::find_by_id(id)
                    .one(database)
                    .await?
                    .ok_or_else(|| DbErr::Custom(format!("{field}: Work item not found.")))?;
                if issue.project_id != sprint.project_id {
                    return Err(DbErr::Custom(format!(
                        "{field}: The work item must belong to the sprint's project."
                    )));
                }
            }
        }
        Ok(self)
    }
}

fn required(value: &ActiveValue<String>, field: &str) -> Result<String, DbErr> {
    match value {
        ActiveValue::Set(value) | ActiveValue::Unchanged(value) => Ok(value.clone()),
        ActiveValue::NotSet => Err(DbErr::Custom(format!("{field}: This field is required."))),
    }
}

fn optional(value: &ActiveValue<Option<String>>) -> Option<String> {
    match value {
        ActiveValue::Set(value) | ActiveValue::Unchanged(value) => value.clone(),
        ActiveValue::NotSet => None,
    }
}
