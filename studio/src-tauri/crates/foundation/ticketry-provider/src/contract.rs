use serde::{Deserialize, Serialize};

use crate::{
    providers, CatalogRefreshPolicy, DirectoryTrustApproval, DirectoryTrustContext,
    DirectoryTrustInspection, DirectoryTrustPreparation, InstallationCatalog,
    LaunchConstructionRequest, ProfileSelection, ProviderError, ProviderErrorCode, ProviderLaunch,
    ProviderLaunchMetadata,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[repr(u8)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
    Gemini,
    Agy,
}

impl Provider {
    pub const ALL: [Self; 4] = [Self::Claude, Self::Codex, Self::Gemini, Self::Agy];

    pub const fn slug(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Agy => "agy",
        }
    }

    pub fn from_slug(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.slug() == value)
    }
}

impl TryFrom<&str> for Provider {
    type Error = ProviderError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::from_slug(value).ok_or_else(|| {
            ProviderError::new(
                ProviderErrorCode::UnknownProvider,
                format!("Provider '{value}' is not registered."),
            )
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderMetadata {
    pub slug: &'static str,
    pub settings_configurable: bool,
    pub supports_unattended: bool,
}

pub trait ProviderContract: Sync {
    fn metadata(&self) -> &'static ProviderMetadata;
    fn launch_metadata(&self) -> &'static ProviderLaunchMetadata;
    fn installation_catalog(&self) -> &'static InstallationCatalog;
    fn refresh_policy(&self) -> CatalogRefreshPolicy;
    fn efforts_for_model(&self, model: &str) -> Option<&'static [&'static str]>;
    fn profile_defaults(&self) -> &'static [&'static str];
    fn normalize_profiles(&self, profiles: &[String]) -> Result<Vec<String>, ProviderError>;
    fn validate_profile_selection(
        &self,
        selection: ProfileSelection<'_>,
        registered_profiles: &[String],
    ) -> Result<(), ProviderError>;
    fn inspect_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
    ) -> DirectoryTrustInspection;
    fn prepare_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
        approval: Option<&DirectoryTrustApproval>,
    ) -> DirectoryTrustPreparation;
    fn construct_launch(
        &self,
        request: &LaunchConstructionRequest<'_>,
    ) -> Result<ProviderLaunch, ProviderError>;
}

pub fn provider_contract(provider: Provider) -> &'static dyn ProviderContract {
    match provider {
        Provider::Claude => &providers::CLAUDE,
        Provider::Codex => &providers::CODEX,
        Provider::Gemini => &providers::GEMINI,
        Provider::Agy => &providers::AGY,
    }
}
