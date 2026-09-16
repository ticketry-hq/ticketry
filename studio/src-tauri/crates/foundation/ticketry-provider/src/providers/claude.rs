use crate::{
    catalog::efforts_for, launch, profile, trust, CatalogRefreshPolicy, DirectoryTrustApproval,
    DirectoryTrustContext, DirectoryTrustInspection, DirectoryTrustPreparation,
    InstallationCatalog, LaunchConstructionRequest, ModelDefinition, ProfileSelection, Provider,
    ProviderContract, ProviderError, ProviderLaunch, ProviderLaunchMetadata, ProviderMetadata,
    TimeoutUnit,
};

pub(crate) struct Claude;
pub(crate) static CLAUDE: Claude = Claude;

const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const MODELS: &[ModelDefinition] = &[
    ModelDefinition {
        name: "sonnet",
        efforts: EFFORTS,
    },
    ModelDefinition {
        name: "opus",
        efforts: EFFORTS,
    },
    ModelDefinition {
        name: "haiku",
        efforts: EFFORTS,
    },
    ModelDefinition {
        name: "fable",
        efforts: EFFORTS,
    },
];
const METADATA: ProviderMetadata = ProviderMetadata {
    slug: Provider::Claude.slug(),
    settings_configurable: true,
    supports_unattended: true,
};
const LAUNCH: ProviderLaunchMetadata = ProviderLaunchMetadata {
    invocation_prefix: "/",
    ready_composer_marker: Some("\u{276f}"),
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
        "Notification",
        "PermissionRequest",
        "Stop",
        "SessionEnd",
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

impl ProviderContract for Claude {
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
        _context: DirectoryTrustContext<'_>,
    ) -> DirectoryTrustInspection {
        trust::unsupported_inspection()
    }
    fn prepare_directory_trust(
        &self,
        _context: DirectoryTrustContext<'_>,
        _approval: Option<&DirectoryTrustApproval>,
    ) -> DirectoryTrustPreparation {
        trust::unsupported_preparation()
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
        launch::claude(request, &LAUNCH)
    }
}
