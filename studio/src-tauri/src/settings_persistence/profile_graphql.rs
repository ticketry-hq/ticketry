#![allow(non_snake_case)]

use std::path::Path;

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::graphql_types::{
    LocalFeatureFlags, LocalFeatureFlagsInput, LocalModuleLink, LocalModuleLinkInput, LocalProfile,
    LocalProfileInput, LocalSettings,
};
use super::{FeatureStore, ProfileCatalog, ProfileStore, SettingsPersistenceError};

#[derive(Clone)]
pub struct SettingsStores {
    profiles: ProfileStore,
    features: FeatureStore,
}

impl SettingsStores {
    pub fn new(data_directory: &Path) -> Self {
        Self {
            profiles: ProfileStore::new(data_directory.join("profiles.json")),
            features: FeatureStore::new(data_directory.join("features.json")),
        }
    }

    /// The one profile store this composition mutates through. Its mutation
    /// lock is per instance, so every in-process writer must share it rather
    /// than construct a second store over the same `profiles.json`.
    pub fn profiles(&self) -> &ProfileStore {
        &self.profiles
    }

    fn snapshot(&self) -> LocalSettings {
        self.with_catalog(self.profiles.read())
    }

    fn with_catalog(&self, catalog: ProfileCatalog) -> LocalSettings {
        LocalSettings::from_catalog(catalog, self.features.read())
    }

    pub fn ensure_local_profile(
        &self,
        name: &str,
        workspace_slug: &str,
    ) -> Result<(), SettingsPersistenceError> {
        if !self.profiles.read().profiles.is_empty() {
            return Ok(());
        }

        self.profiles.update(|catalog| {
            if catalog.profiles.is_empty() {
                catalog.profiles.push(super::Profile {
                    name: name.to_owned(),
                    workspace_slug: workspace_slug.to_owned(),
                    agent_prompt: None,
                    agent_prompts: Default::default(),
                    module_links: Vec::new(),
                    recent_project_id: None,
                    recent_module_ids: Default::default(),
                });
                catalog.recent_profile_index = Some(0);
            }
            Ok(())
        })?;
        Ok(())
    }
}

pub struct ProfileQueries;

#[CustomFields]
impl ProfileQueries {
    async fn local_settings(ctx: &Context<'_>) -> Result<LocalSettings> {
        Ok(stores(ctx)?.snapshot())
    }
}

pub struct ProfileMutations;

#[CustomFields]
impl ProfileMutations {
    async fn add_local_profile(
        ctx: &Context<'_>,
        profile: LocalProfileInput,
    ) -> Result<LocalSettings> {
        let stores = stores(ctx)?;
        let profile = profile.try_into().map_err(settings_error)?;
        let catalog = stores.profiles.add(profile).map_err(settings_error)?;
        Ok(stores.with_catalog(catalog))
    }

    async fn replace_local_profile(
        ctx: &Context<'_>,
        index: i32,
        profile: LocalProfileInput,
    ) -> Result<LocalSettings> {
        let stores = stores(ctx)?;
        let profile = profile.try_into().map_err(settings_error)?;
        let catalog = stores
            .profiles
            .replace_at(index, profile)
            .map_err(settings_error)?;
        Ok(stores.with_catalog(catalog))
    }

    async fn delete_local_profile(ctx: &Context<'_>, index: i32) -> Result<LocalSettings> {
        let stores = stores(ctx)?;
        let catalog = stores.profiles.delete_at(index).map_err(settings_error)?;
        Ok(stores.with_catalog(catalog))
    }

    async fn select_local_profile(ctx: &Context<'_>, index: i32) -> Result<LocalSettings> {
        let stores = stores(ctx)?;
        let catalog = stores.profiles.select(index).map_err(settings_error)?;
        Ok(stores.with_catalog(catalog))
    }

    async fn replace_feature_flags(
        ctx: &Context<'_>,
        features: LocalFeatureFlagsInput,
    ) -> Result<LocalSettings> {
        let stores = stores(ctx)?;
        let features = stores
            .features
            .replace(features.into())
            .map_err(settings_error)?;
        Ok(LocalSettings::from_catalog(
            stores.profiles.read(),
            features,
        ))
    }
}

pub fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_output::<LocalSettings>();
    builder.register_custom_output::<LocalProfile>();
    builder.register_custom_output::<LocalModuleLink>();
    builder.register_custom_output::<LocalFeatureFlags>();
    builder.register_custom_input::<LocalProfileInput>();
    builder.register_custom_input::<LocalModuleLinkInput>();
    builder.register_custom_input::<LocalFeatureFlagsInput>();
    builder.register_custom_query::<ProfileQueries>();
    builder.register_custom_mutation::<ProfileMutations>();
    builder
}

fn stores<'a>(ctx: &'a Context<'a>) -> Result<&'a SettingsStores> {
    ctx.data::<SettingsStores>().map_err(|_| {
        Error::new("Local settings are unavailable.")
            .extend_with(|_, extension| extension.set("code", "settings_write_unavailable"))
    })
}

fn settings_error(error: SettingsPersistenceError) -> Error {
    let message = if matches!(error, SettingsPersistenceError::IndexOutOfRange) {
        error.code().to_owned()
    } else {
        error.to_string()
    };
    Error::new(message)
        .extend_with(|_, extension| extension.set("code", error.code()))
        .extend_with(|_, extension| extension.set("detail", error.to_string()))
}
