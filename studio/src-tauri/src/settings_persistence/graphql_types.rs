use std::collections::BTreeMap;

use seaography::{CustomInputType, CustomOutputType};
use serde_json::{Map, Value};

use super::{
    keybindings::JsonValue, FeatureFlags, ModuleLink, Profile, ProfileCatalog,
    SettingsPersistenceError,
};

#[derive(Clone, Debug, PartialEq, CustomOutputType)]
pub struct LocalSettings {
    pub recent_profile_index: Option<i32>,
    pub profiles: Vec<LocalProfile>,
    pub features: LocalFeatureFlags,
}

impl LocalSettings {
    pub fn from_catalog(catalog: ProfileCatalog, features: FeatureFlags) -> Self {
        Self {
            recent_profile_index: catalog.recent_profile_index,
            profiles: catalog
                .profiles
                .into_iter()
                .map(LocalProfile::from)
                .collect(),
            features: features.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, CustomOutputType)]
pub struct LocalProfile {
    pub name: String,
    pub workspace_slug: String,
    pub agent_prompt: Option<String>,
    pub agent_prompts: JsonValue,
    pub module_links: Vec<LocalModuleLink>,
    pub recent_project_id: Option<String>,
    pub recent_module_ids: JsonValue,
}

impl From<Profile> for LocalProfile {
    fn from(profile: Profile) -> Self {
        Self {
            name: profile.name,
            workspace_slug: profile.workspace_slug,
            agent_prompt: profile.agent_prompt,
            agent_prompts: object_value(profile.agent_prompts),
            module_links: profile
                .module_links
                .into_iter()
                .map(LocalModuleLink::from)
                .collect(),
            recent_project_id: profile.recent_project_id,
            recent_module_ids: object_value(profile.recent_module_ids),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct LocalModuleLink {
    pub module_id: String,
    pub path: String,
}

impl From<ModuleLink> for LocalModuleLink {
    fn from(link: ModuleLink) -> Self {
        Self {
            module_id: link.module_id,
            path: link.path,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, CustomOutputType)]
pub struct LocalFeatureFlags {
    pub sidebar: bool,
    pub projects: bool,
}

impl From<FeatureFlags> for LocalFeatureFlags {
    fn from(flags: FeatureFlags) -> Self {
        Self {
            sidebar: flags.sidebar,
            projects: flags.projects,
        }
    }
}

#[derive(Clone, Debug, CustomInputType)]
#[seaography(input_type_name = "LocalProfileInput")]
pub struct LocalProfileInput {
    pub name: String,
    pub workspace_slug: String,
    pub agent_prompt: Option<String>,
    pub agent_prompts: Option<JsonValue>,
    pub module_links: Option<Vec<LocalModuleLinkInput>>,
    pub recent_project_id: Option<String>,
    pub recent_module_ids: Option<JsonValue>,
}

impl TryFrom<LocalProfileInput> for Profile {
    type Error = SettingsPersistenceError;

    fn try_from(input: LocalProfileInput) -> Result<Self, Self::Error> {
        Ok(Self {
            name: input.name,
            workspace_slug: input.workspace_slug,
            agent_prompt: input.agent_prompt,
            agent_prompts: object_map(input.agent_prompts, "agent_prompts")?,
            module_links: input
                .module_links
                .unwrap_or_default()
                .into_iter()
                .map(ModuleLink::from)
                .collect(),
            recent_project_id: input.recent_project_id,
            recent_module_ids: object_map(input.recent_module_ids, "recent_module_ids")?,
        })
    }
}

#[derive(Clone, Debug, CustomInputType)]
#[seaography(input_type_name = "LocalModuleLinkInput")]
pub struct LocalModuleLinkInput {
    pub module_id: String,
    pub path: String,
}

impl From<LocalModuleLinkInput> for ModuleLink {
    fn from(link: LocalModuleLinkInput) -> Self {
        Self {
            module_id: link.module_id,
            path: link.path,
        }
    }
}

#[derive(Clone, Copy, Debug, CustomInputType)]
#[seaography(input_type_name = "LocalFeatureFlagsInput")]
pub struct LocalFeatureFlagsInput {
    pub sidebar: bool,
    pub projects: bool,
}

impl From<LocalFeatureFlagsInput> for FeatureFlags {
    fn from(flags: LocalFeatureFlagsInput) -> Self {
        Self {
            sidebar: flags.sidebar,
            projects: flags.projects,
        }
    }
}

fn object_map(
    value: Option<JsonValue>,
    field: &'static str,
) -> Result<BTreeMap<String, Value>, SettingsPersistenceError> {
    match value
        .map(|value| value.0)
        .unwrap_or_else(|| Value::Object(Map::new()))
    {
        Value::Object(values) => Ok(values.into_iter().collect()),
        _ => Err(SettingsPersistenceError::InvalidProfileField { field }),
    }
}

fn object_value(values: BTreeMap<String, Value>) -> JsonValue {
    JsonValue(Value::Object(values.into_iter().collect()))
}
