use std::time::{SystemTime, UNIX_EPOCH};

use seaography::{
    async_graphql::dynamic::{FieldValue, TypeRef, ValueAccessor},
    BuilderContext, CustomInputType, CustomOutputType, SeaResult, SeaographyError,
};
use serde::Serialize;

use super::{AppSetting, AppSettingRepository, SettingKey, SettingScope, SettingsPersistenceError};

const KEYBINDING_SCOPE: &str = "host";
const KEYBINDING_KEY: &str = "keybindings";

#[derive(Clone, Debug, PartialEq, Serialize, CustomOutputType)]
pub struct KeybindingSetting {
    pub scope: String,
    pub key: String,
    pub value: JsonValue,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JsonValue(pub serde_json::Value);

impl CustomInputType for JsonValue {
    fn gql_input_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::named_nn("Json")
    }

    fn parse_value(
        _ctx: &'static BuilderContext,
        value: Option<ValueAccessor<'_>>,
    ) -> SeaResult<Self> {
        value
            .map(|value| value.deserialize().map(Self))
            .transpose()?
            .ok_or_else(|| SeaographyError::AsyncGraphQLError("Value expected".into()))
    }
}

impl CustomOutputType for JsonValue {
    fn gql_output_type_ref(_ctx: &'static BuilderContext) -> TypeRef {
        TypeRef::named_nn("Json")
    }

    fn gql_field_value(self, _ctx: &'static BuilderContext) -> Option<FieldValue<'static>> {
        async_graphql_value(self.0).map(FieldValue::value)
    }
}

pub async fn read(
    repository: &AppSettingRepository,
) -> Result<Option<KeybindingSetting>, SettingsPersistenceError> {
    let row = repository.get(&scope()?, &key()?).await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let Ok(value) = serde_json::from_str(&row.value) else {
        return Ok(None);
    };
    Ok(Some(KeybindingSetting {
        scope: row.scope.as_str().to_owned(),
        key: row.key.as_str().to_owned(),
        value: JsonValue(value),
        updated_at: row.updated_at,
    }))
}

pub async fn update(
    repository: &AppSettingRepository,
    value: JsonValue,
) -> Result<KeybindingSetting, SettingsPersistenceError> {
    let updated_at = now();
    let setting = AppSetting {
        scope: scope()?,
        key: key()?,
        value: serde_json::to_string(&value.0)?,
        updated_at: updated_at.clone(),
    };
    repository.put(&setting).await?;
    Ok(KeybindingSetting {
        scope: setting.scope.as_str().to_owned(),
        key: setting.key.as_str().to_owned(),
        value,
        updated_at,
    })
}

fn async_graphql_value(value: serde_json::Value) -> Option<seaography::async_graphql::Value> {
    seaography::async_graphql::Value::from_json(value).ok()
}

fn scope() -> Result<SettingScope, SettingsPersistenceError> {
    SettingScope::new(KEYBINDING_SCOPE)
}

fn key() -> Result<SettingKey, SettingsPersistenceError> {
    SettingKey::new(KEYBINDING_KEY)
}

fn now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock predates the Unix epoch");
    sea_orm::prelude::DateTimeUtc::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("the system clock is outside SQLite's datetime range")
        .to_rfc3339()
}
