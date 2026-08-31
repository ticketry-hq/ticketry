#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::{
    app_setting, instant_launch, keybindings, AppSettingRepository, GlobalLaunchDefault,
    ProviderCatalog, ProviderCatalogError, ProviderCatalogService, ProviderCatalogUpdate,
    SettingsPersistenceError,
};
use crate::graphql_scalars::StringList;

pub struct SettingsQueries;

#[CustomFields]
impl SettingsQueries {
    async fn keybinding_setting(
        ctx: &Context<'_>,
    ) -> Result<Option<super::entities::app_settings::Model>> {
        keybindings::read(repository(ctx)?)
            .await
            .map_err(|error| settings_error(error, "Keyboard shortcuts could not be loaded."))
    }

    async fn instant_launch_setting(
        ctx: &Context<'_>,
    ) -> Result<Option<super::entities::app_settings::Model>> {
        instant_launch::read(repository(ctx)?)
            .await
            .map_err(|error| settings_error(error, "Instant settings could not be loaded."))
    }

    async fn provider_catalog(ctx: &Context<'_>) -> Result<ProviderCatalog> {
        provider_catalog(ctx)?.load().await.map_err(catalog_error)
    }
}

pub struct SettingsMutations;

#[CustomFields]
impl SettingsMutations {
    async fn update_provider_catalog(
        ctx: &Context<'_>,
        activated_providers: StringList,
        default_provider: Option<String>,
        default_model: Option<String>,
        default_reasoning: Option<String>,
    ) -> Result<ProviderCatalog> {
        if default_provider.is_none() && (default_model.is_some() || default_reasoning.is_some()) {
            return Err(catalog_error(ProviderCatalogError::Validation {
                field: "default_provider",
                message: "Choose a catalog provider before configuring model or reasoning."
                    .to_owned(),
            }));
        }
        let global_default = default_provider.map(|provider| GlobalLaunchDefault {
            provider,
            model: default_model,
            reasoning: default_reasoning,
        });
        provider_catalog(ctx)?
            .update(ProviderCatalogUpdate {
                activated_providers: activated_providers.0,
                global_default,
            })
            .await
            .map_err(catalog_error)
    }
}

pub fn register(builder: seaography::Builder) -> seaography::Builder {
    let mut builder = app_setting::register(builder);
    builder.register_custom_output::<GlobalLaunchDefault>();
    builder.register_custom_output::<ProviderCatalog>();
    builder.register_custom_query::<SettingsQueries>();
    builder.register_custom_mutation::<SettingsMutations>();
    builder
}

fn provider_catalog<'a>(ctx: &'a Context<'a>) -> Result<&'a ProviderCatalogService> {
    ctx.data::<ProviderCatalogService>().map_err(|_| {
        Error::new("The provider catalog is unavailable.")
            .extend_with(|_, extension| extension.set("code", "provider_catalog_unavailable"))
    })
}

fn repository<'a>(ctx: &'a Context<'a>) -> Result<&'a AppSettingRepository> {
    ctx.data::<AppSettingRepository>().map_err(|_| {
        Error::new("Settings storage is unavailable.")
            .extend_with(|_, extension| extension.set("code", "settings_store_unavailable"))
    })
}

pub(super) fn settings_error(error: SettingsPersistenceError, message: &'static str) -> Error {
    Error::new(message)
        .extend_with(|_, extension| extension.set("code", error.code()))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}

fn catalog_error(error: ProviderCatalogError) -> Error {
    let code = error.code();
    let field = error.field();
    let detail = error.to_string();
    let mut error = Error::new(detail.clone())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", detail));
    if let Some(field) = field {
        error = error.extend_with(|_, extension| extension.set("field", field));
    }
    error
}
