use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue, QueryFilter, Set};

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_issuetype")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub level: String,
    pub color: String,
    pub sort_order: i32,
    pub start_state_id: Option<String>,
    pub workflow_revision: i32,
    pub is_pathfind: bool,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "project_id", to = "id")]
    pub project: BelongsTo<super::project::Entity>,
    #[sea_orm(belongs_to, from = "start_state_id", to = "id")]
    pub start_state: BelongsTo<Option<super::state::Entity>>,
    #[sea_orm(has_many)]
    pub issues: HasMany<super::issue::Entity>,
    #[sea_orm(has_many)]
    pub transitions: HasMany<super::issue_type_transition::Entity>,
    #[sea_orm(has_many)]
    pub launch_bindings: HasMany<super::launch_binding::Entity>,
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, database: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if !insert {
            return Ok(self);
        }

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
        let level = required(&self.level, "level")?;
        if !matches!(level.as_str(), "module" | "task") {
            return Err(DbErr::Custom(format!("Unknown level '{level}'.")));
        }

        let existing = Entity::find()
            .filter(Column::ProjectId.eq(&project_id))
            .all(database)
            .await?;
        if existing.iter().any(|row| row.name == name) {
            return Err(DbErr::Custom(format!(
                "Issue type '{name}' already exists."
            )));
        }

        self.project_id = Set(project_id);
        self.name = Set(name);
        if self.id.is_not_set() {
            self.id = Set(uuid::Uuid::new_v4().simple().to_string());
        }
        if self.color.is_not_set() {
            self.color = Set(String::new());
        }
        if self.sort_order.is_not_set() {
            self.sort_order = Set(existing
                .iter()
                .filter(|row| row.level == level)
                .map(|row| row.sort_order)
                .max()
                .map_or(0, |value| value + 1));
        }
        if self.start_state_id.is_not_set() {
            self.start_state_id = Set(None);
        }
        if self.workflow_revision.is_not_set() {
            self.workflow_revision = Set(0);
        }
        if self.is_pathfind.is_not_set() {
            self.is_pathfind = Set(false);
        }
        let now = chrono::Utc::now().naive_utc();
        if self.created_at.is_not_set() {
            self.created_at = Set(now);
        }
        if self.updated_at.is_not_set() {
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
