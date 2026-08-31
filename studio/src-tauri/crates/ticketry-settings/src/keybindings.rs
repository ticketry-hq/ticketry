use super::{
    entities::app_settings, AppSettingRepository, SettingKey, SettingScope,
    SettingsPersistenceError,
};

const KEYBINDING_SCOPE: &str = "host";
const KEYBINDING_KEY: &str = "keybindings";

pub async fn read(
    repository: &AppSettingRepository,
) -> Result<Option<app_settings::Model>, SettingsPersistenceError> {
    let row = repository.get(&scope()?, &key()?).await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.value) else {
        return Ok(None);
    };
    Ok(Some(app_settings::Model {
        scope: row.scope.as_str().to_owned(),
        key: row.key.as_str().to_owned(),
        value: serde_json::to_string(&value)?,
        updated_at: row.updated_at,
    }))
}

pub(super) fn fixed_identity() -> Result<(SettingScope, SettingKey), SettingsPersistenceError> {
    Ok((scope()?, key()?))
}

fn scope() -> Result<SettingScope, SettingsPersistenceError> {
    SettingScope::new(KEYBINDING_SCOPE)
}

fn key() -> Result<SettingKey, SettingsPersistenceError> {
    SettingKey::new(KEYBINDING_KEY)
}
