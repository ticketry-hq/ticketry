use std::path::Path;
use std::time::Duration;

use sea_orm::{
    sea_query::OnConflict, ActiveValue::Set, ColumnTrait, ConnectOptions, Database,
    DatabaseConnection, EntityTrait, QueryFilter,
};

use super::entities::app_settings as app_setting;
use super::SettingsPersistenceError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettingScope(String);

impl SettingScope {
    pub fn new(value: impl Into<String>) -> Result<Self, SettingsPersistenceError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(SettingsPersistenceError::InvalidIdentity { field: "scope" });
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettingKey(String);

impl SettingKey {
    pub fn new(value: impl Into<String>) -> Result<Self, SettingsPersistenceError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(SettingsPersistenceError::InvalidIdentity { field: "key" });
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppSetting {
    pub scope: SettingScope,
    pub key: SettingKey,
    pub value: String,
    pub updated_at: String,
}

/// Restricted model-shaped seam for the composite-key `app_settings` table.
///
/// This is intentionally not a Seaography entity, so generated CRUD cannot
/// expose identity or timestamp fields as public mutations.
#[derive(Clone)]
pub struct AppSettingRepository {
    database: DatabaseConnection,
}

impl AppSettingRepository {
    pub async fn open(path: &Path) -> Result<Self, SettingsPersistenceError> {
        let database_path = path.to_owned();
        let mut options = ConnectOptions::new("sqlite:state.db?mode=rw");
        options
            .max_connections(8)
            .min_connections(1)
            .sqlx_logging(cfg!(debug_assertions))
            .map_sqlx_sqlite_opts(move |options| {
                options
                    .filename(database_path.clone())
                    .create_if_missing(false)
                    .busy_timeout(Duration::from_secs(5))
                    .pragma("foreign_keys", "ON")
            });
        Ok(Self {
            database: Database::connect(options).await?,
        })
    }

    pub fn database(&self) -> DatabaseConnection {
        self.database.clone()
    }

    pub async fn get(
        &self,
        scope: &SettingScope,
        key: &SettingKey,
    ) -> Result<Option<AppSetting>, SettingsPersistenceError> {
        let row = app_setting::Entity::find()
            .filter(app_setting::Column::Scope.eq(scope.as_str()))
            .filter(app_setting::Column::Key.eq(key.as_str()))
            .one(&self.database)
            .await?;
        row.map(|row| {
            Ok(AppSetting {
                scope: SettingScope::new(row.scope)?,
                key: SettingKey::new(row.key)?,
                value: row.value,
                updated_at: row.updated_at,
            })
        })
        .transpose()
    }

    pub async fn put(&self, setting: &AppSetting) -> Result<(), SettingsPersistenceError> {
        if setting.updated_at.trim().is_empty() {
            return Err(SettingsPersistenceError::InvalidIdentity {
                field: "updated_at",
            });
        }
        app_setting::Entity::insert(app_setting::ActiveModel {
            scope: Set(setting.scope.as_str().to_owned()),
            key: Set(setting.key.as_str().to_owned()),
            value: Set(setting.value.clone()),
            updated_at: Set(setting.updated_at.clone()),
        })
        .on_conflict(
            OnConflict::columns([app_setting::Column::Scope, app_setting::Column::Key])
                .update_columns([app_setting::Column::Value, app_setting::Column::UpdatedAt])
                .to_owned(),
        )
        .exec(&self.database)
        .await?;
        Ok(())
    }
}
