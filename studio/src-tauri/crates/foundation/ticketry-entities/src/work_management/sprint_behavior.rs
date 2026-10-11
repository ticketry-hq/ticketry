//! Authored lifecycle validation, independent of the schema-generated mapping.
use super::sprint::ActiveModel;
use super::sprint_status::{
    SPRINT_ACTIVE as ACTIVE, SPRINT_COMPLETED as COMPLETED, SPRINT_PLANNED as PLANNED,
};
use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue, Set};

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, database: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        let now = chrono::Utc::now().naive_utc();
        if insert {
            let project_id = required(&self.project_id, "project_id")?;
            let project_id = uuid::Uuid::parse_str(&project_id)
                .map(|value| value.simple().to_string())
                .map_err(|_| invalid("project_id", "Enter a valid UUID."))?;
            if super::project::Entity::find_by_id(&project_id)
                .one(database)
                .await?
                .is_none()
            {
                return Err(DbErr::Custom("Project not found.".to_owned()));
            }
            self.project_id = Set(project_id);
            if self.id.is_not_set() {
                self.id = Set(uuid::Uuid::new_v4().simple().to_string());
            }
            if self.status.is_not_set() {
                self.status = Set(PLANNED.to_owned());
            }
            if self.suggestion_run_id.is_not_set() {
                self.suggestion_run_id = Set(None);
            }
            if self.goals_revised_at.is_not_set() {
                self.goals_revised_at = Set(None);
            }
            if self.created_at.is_not_set() {
                self.created_at = Set(now);
            }
        }
        if insert || self.name.is_set() {
            let name = required(&self.name, "name")?.trim().to_owned();
            if name.is_empty() {
                return Err(invalid("name", "This field may not be blank."));
            }
            if name.chars().count() > 255 {
                return Err(invalid(
                    "name",
                    "Ensure this field has no more than 255 characters.",
                ));
            }
            self.name = Set(name);
        }
        if let ActiveValue::Set(status) = &self.status {
            if !matches!(status.as_str(), PLANNED | ACTIVE | COMPLETED) {
                return Err(DbErr::Custom(format!("status: Unknown status '{status}'.")));
            }
        }
        if !self.updated_at.is_set() {
            self.updated_at = Set(now);
        }
        Ok(self)
    }
}

fn required(value: &ActiveValue<String>, field: &'static str) -> Result<String, DbErr> {
    match value {
        ActiveValue::Set(value) | ActiveValue::Unchanged(value) => Ok(value.clone()),
        ActiveValue::NotSet => Err(invalid(field, "This field is required.")),
    }
}

fn invalid(field: &'static str, message: &'static str) -> DbErr {
    DbErr::Custom(format!("{field}: {message}"))
}
