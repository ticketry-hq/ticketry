use sea_orm::{DatabaseConnection, EntityTrait};
use serde::{Deserialize, Serialize};

use super::{
    entities::app_settings, AppSettingRepository, SettingKey, SettingScope,
    SettingsPersistenceError,
};

const INSTANT_SCOPE: &str = "host";
const INSTANT_KEY: &str = "instant_launch";
pub const MAX_INITIAL_PROMPT_CHARACTERS: usize = 8_000;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct InstantLaunchSettings {
    pub initial_prompt: String,
    pub auto_close: bool,
}

impl InstantLaunchSettings {
    pub fn new(initial_prompt: String, auto_close: bool) -> Option<Self> {
        (initial_prompt.chars().count() <= MAX_INITIAL_PROMPT_CHARACTERS).then_some(Self {
            initial_prompt,
            auto_close,
        })
    }
}

pub async fn read(
    repository: &AppSettingRepository,
) -> Result<Option<app_settings::Model>, SettingsPersistenceError> {
    let row = repository.get(&scope()?, &key()?).await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let Ok(value) = serde_json::from_str::<InstantLaunchSettings>(&row.value) else {
        return Ok(None);
    };
    if InstantLaunchSettings::new(value.initial_prompt, value.auto_close).is_none() {
        return Ok(None);
    }
    Ok(Some(app_settings::Model {
        scope: row.scope.as_str().to_owned(),
        key: row.key.as_str().to_owned(),
        value: row.value,
        updated_at: row.updated_at,
    }))
}

pub async fn load(database: &DatabaseConnection) -> Result<InstantLaunchSettings, sea_orm::DbErr> {
    let row = app_settings::Entity::find_by_id((INSTANT_SCOPE.to_owned(), INSTANT_KEY.to_owned()))
        .one(database)
        .await?;
    Ok(row
        .and_then(|row| serde_json::from_str::<InstantLaunchSettings>(&row.value).ok())
        .and_then(|value| InstantLaunchSettings::new(value.initial_prompt, value.auto_close))
        .unwrap_or_default())
}

pub(super) fn fixed_identity() -> Result<(SettingScope, SettingKey), SettingsPersistenceError> {
    Ok((scope()?, key()?))
}

fn scope() -> Result<SettingScope, SettingsPersistenceError> {
    SettingScope::new(INSTANT_SCOPE)
}

fn key() -> Result<SettingKey, SettingsPersistenceError> {
    SettingKey::new(INSTANT_KEY)
}
