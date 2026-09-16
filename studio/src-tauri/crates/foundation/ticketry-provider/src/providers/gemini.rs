use crate::{
    catalog::efforts_for, launch, profile, trust, CatalogRefreshPolicy, DirectoryTrustApproval,
    DirectoryTrustContext, DirectoryTrustInspection, DirectoryTrustPreparation,
    InstallationCatalog, LaunchConstructionRequest, ModelDefinition, ProfileSelection, Provider,
    ProviderContract, ProviderError, ProviderLaunch, ProviderLaunchMetadata, ProviderMetadata,
    TimeoutUnit,
};

pub(crate) struct Gemini;
pub(crate) static GEMINI: Gemini = Gemini;

const MODELS: &[ModelDefinition] = &[ModelDefinition {
    name: "gemini-3.1-pro-preview",
    efforts: &[],
}];
const METADATA: ProviderMetadata = ProviderMetadata {
    slug: Provider::Gemini.slug(),
    settings_configurable: true,
    supports_unattended: true,
};
const LAUNCH: ProviderLaunchMetadata = ProviderLaunchMetadata {
    invocation_prefix: "/",
    ready_composer_marker: Some("> Type your message"),
    supports_model: true,
    supports_reasoning: false,
    supports_resume: true,
    supports_worktracker_mcp: true,
    supports_required_skills: true,
    hook_events: &[
        "SessionStart",
        "BeforeAgent",
        "BeforeTool",
        "AfterTool",
        "Notification",
        "AfterAgent",
        "SessionEnd",
    ],
    hook_timeout: 5_000,
    hook_timeout_unit: TimeoutUnit::Milliseconds,
    settings_environment: Some("GEMINI_CLI_SYSTEM_SETTINGS_PATH"),
};
const CATALOG: InstallationCatalog = InstallationCatalog {
    active_by_default: true,
    models: MODELS,
    default_model: None,
    default_effort: None,
};

impl ProviderContract for Gemini {
    fn metadata(&self) -> &'static ProviderMetadata {
        &METADATA
    }
    fn launch_metadata(&self) -> &'static ProviderLaunchMetadata {
        &LAUNCH
    }
    fn installation_catalog(&self) -> &'static InstallationCatalog {
        &CATALOG
    }
    fn refresh_policy(&self) -> CatalogRefreshPolicy {
        CatalogRefreshPolicy::PersistedDatabase
    }
    fn efforts_for_model(&self, model: &str) -> Option<&'static [&'static str]> {
        efforts_for(&CATALOG, model)
    }
    fn profile_defaults(&self) -> &'static [&'static str] {
        &[]
    }
    fn normalize_profiles(&self, profiles: &[String]) -> Result<Vec<String>, ProviderError> {
        profile::normalize_unsupported(profiles)
    }
    fn validate_profile_selection(
        &self,
        selection: ProfileSelection<'_>,
        _registered_profiles: &[String],
    ) -> Result<(), ProviderError> {
        profile::validate_unsupported(selection)
    }
    fn inspect_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
    ) -> DirectoryTrustInspection {
        trust::inspect_gemini(context)
    }
    fn prepare_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
        approval: Option<&DirectoryTrustApproval>,
    ) -> DirectoryTrustPreparation {
        trust::prepare_gemini(context, approval)
    }
    fn construct_launch(
        &self,
        request: &LaunchConstructionRequest<'_>,
    ) -> Result<ProviderLaunch, ProviderError> {
        self.validate_profile_selection(
            ProfileSelection {
                profile: request.options.profile,
                model: request.options.model,
                effort: request.options.effort,
            },
            request.registered_profiles,
        )?;
        launch::gemini(request, &LAUNCH)
    }
}
