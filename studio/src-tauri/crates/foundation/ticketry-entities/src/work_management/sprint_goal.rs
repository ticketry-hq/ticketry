use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue, Set};

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "worktracker_sprint_goal")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub sprint_id: String,
    pub position: i32,
    pub text: String,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "sprint_id", to = "id")]
    pub sprint: BelongsTo<super::sprint::Entity>,
}

#[async_trait::async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, _database: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if insert || self.text.is_set() {
            let text = match &self.text {
                ActiveValue::Set(text) | ActiveValue::Unchanged(text) => text.trim().to_owned(),
                ActiveValue::NotSet => {
                    return Err(DbErr::Custom("text: This field is required.".into()))
                }
            };
            if text.is_empty() {
                return Err(DbErr::Custom("text: This field may not be blank.".into()));
            }
            self.text = Set(text);
        }
        let now = chrono::Utc::now().naive_utc();
        if insert {
            if self.id.is_not_set() {
                self.id = Set(uuid::Uuid::new_v4().simple().to_string());
            }
            if self.created_at.is_not_set() {
                self.created_at = Set(now);
            }
        }
        if !self.updated_at.is_set() {
            self.updated_at = Set(now);
        }
        Ok(self)
    }
}
