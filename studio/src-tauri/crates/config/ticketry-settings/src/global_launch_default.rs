//! The one reader of the persisted global launch default.
//!
//! The `app_settings(host, provider_catalog)` row is written by
//! [`ProviderCatalogService::update`](super::provider_catalog::ProviderCatalogService::update),
//! but rows written before the cutover — or by any other writer — are not
//! guaranteed to be normalized. Every consumer (the Studio catalogue query,
//! launch-binding validation, and launch resolution) parses that row through
//! [`parse_global_launch_default`] so they cannot disagree about whether a
//! default exists or what it says.
//!
//! The semantics are deliberately strict: an object carrying any key outside
//! `provider | model | reasoning`, a non-string field, or a blank provider
//! salvages to *no default* rather than a partially understood one.

use sea_orm::{ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter};
use seaography::CustomOutputType;
use serde::Serialize;

use super::entities::app_settings as app_setting;

pub(super) const PROVIDER_CATALOG_SCOPE: &str = "host";
pub(super) const PROVIDER_CATALOG_KEY: &str = "provider_catalog";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct GlobalLaunchDefault {
    pub provider: String,
    pub model: Option<String>,
    pub reasoning: Option<String>,
}

/// Read and parse the persisted global launch default, if the row exists and
/// carries a default this build understands.
pub async fn read_global_launch_default(
    database: &impl ConnectionTrait,
) -> Result<Option<GlobalLaunchDefault>, DbErr> {
    let row = app_setting::Entity::find()
        .filter(app_setting::Column::Scope.eq(PROVIDER_CATALOG_SCOPE))
        .filter(app_setting::Column::Key.eq(PROVIDER_CATALOG_KEY))
        .one(database)
        .await?;
    Ok(row.and_then(|setting| parse_global_launch_default(&setting.value)))
}

/// Parse the stored provider-catalog document into the global launch default it
/// declares. Returns `None` for malformed documents, an absent or null default,
/// and for any default this build cannot fully understand.
pub fn parse_global_launch_default(value: &str) -> Option<GlobalLaunchDefault> {
    let document = serde_json::from_str::<serde_json::Value>(value).ok()?;
    let raw = document.as_object()?.get("global_default")?;
    if raw.is_null() {
        return None;
    }
    let object = raw.as_object()?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "provider" | "model" | "reasoning"))
    {
        return None;
    }
    let provider = object.get("provider")?.as_str()?.trim().to_owned();
    if provider.is_empty() {
        return None;
    }
    let optional = |field: &str| match object.get(field) {
        None | Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(value)) => {
            let value = value.trim();
            Some((!value.is_empty()).then(|| value.to_owned()))
        }
        Some(_) => None,
    };
    Some(GlobalLaunchDefault {
        provider,
        model: optional("model")?,
        reasoning: optional("reasoning")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_and_unknown_fields_salvage_to_no_default() {
        assert_eq!(parse_global_launch_default("not json"), None);
        assert_eq!(parse_global_launch_default("[]"), None);
        assert_eq!(
            parse_global_launch_default(r#"{"global_default":{"provider":"codex","future":true}}"#),
            None
        );
    }

    #[test]
    fn absent_and_null_defaults_salvage_to_no_default() {
        assert_eq!(parse_global_launch_default(r#"{}"#), None);
        assert_eq!(
            parse_global_launch_default(r#"{"global_default":null}"#),
            None
        );
        assert_eq!(
            parse_global_launch_default(r#"{"global_default":{"provider":"  "}}"#),
            None
        );
        assert_eq!(
            parse_global_launch_default(r#"{"global_default":{"provider":"codex","model":7}}"#),
            None
        );
    }

    #[test]
    fn legacy_outer_fields_are_ignored_while_the_default_is_normalized() {
        assert_eq!(
            parse_global_launch_default(
                r#"{"activated_providers":["claude"],"future":true,"global_default":{"provider":" codex ","model":" gpt-5.4 ","reasoning":" "}}"#
            ),
            Some(GlobalLaunchDefault {
                provider: "codex".to_owned(),
                model: Some("gpt-5.4".to_owned()),
                reasoning: None,
            })
        );
    }
}
