use crate::{
    catalog::efforts_for, launch, profile, trust, CatalogRefreshPolicy, DirectoryTrustApproval,
    DirectoryTrustContext, DirectoryTrustInspection, DirectoryTrustPreparation,
    InstallationCatalog, LaunchConstructionRequest, ModelDefinition, ProfileSelection, Provider,
    ProviderContract, ProviderError, ProviderLaunch, ProviderLaunchMetadata, ProviderMetadata,
    TimeoutUnit,
};

pub(crate) struct Codex;
pub(crate) static CODEX: Codex = Codex;

const EFFORTS: &[&str] = &["minimal", "low", "medium", "high", "xhigh"];
const MODELS: &[ModelDefinition] = &[ModelDefinition {
    name: "gpt-5.4",
    efforts: EFFORTS,
}];
const METADATA: ProviderMetadata = ProviderMetadata {
    slug: Provider::Codex.slug(),
    settings_configurable: true,
    supports_unattended: true,
};
const LAUNCH: ProviderLaunchMetadata = ProviderLaunchMetadata {
    invocation_prefix: "$",
    ready_composer_marker: Some("\u{203a} Ask Codex"),
    supports_model: true,
    supports_reasoning: true,
    supports_resume: true,
    supports_worktracker_mcp: true,
    supports_required_skills: true,
    hook_events: &[
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Stop",
    ],
    hook_timeout: 5,
    hook_timeout_unit: TimeoutUnit::Seconds,
    settings_environment: None,
};
const CATALOG: InstallationCatalog = InstallationCatalog {
    active_by_default: true,
    models: MODELS,
    default_model: None,
    default_effort: None,
};

impl ProviderContract for Codex {
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
        Ok(profile::normalize_supported(profiles))
    }
    fn validate_profile_selection(
        &self,
        selection: ProfileSelection<'_>,
        registered_profiles: &[String],
    ) -> Result<(), ProviderError> {
        profile::validate_supported(selection, registered_profiles)
    }
    fn inspect_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
    ) -> DirectoryTrustInspection {
        trust::inspect_codex(context)
    }
    fn prepare_directory_trust(
        &self,
        context: DirectoryTrustContext<'_>,
        approval: Option<&DirectoryTrustApproval>,
    ) -> DirectoryTrustPreparation {
        trust::prepare_codex(context, approval)
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
        launch::codex(request, &LAUNCH)
    }
}
