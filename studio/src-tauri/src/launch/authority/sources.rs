//! The authoritative sources a launch is resolved from: the provider catalog,
//! the module's typed link, and the run's derived directories.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::work_management::provider;
use crate::launch::paths::{LaunchPathsRequest, LaunchPathsService, LaunchPathsView, LaunchScope};
use crate::launch::planning::Provider;
use crate::settings_persistence::read_global_launch_default;
use crate::launch::terminal_session::{CreateTerminalSession, TerminalLaunchKind};
use crate::worktree::status::repository::module_folder;

use super::error::{LaunchAuthorityError, LaunchAuthorityErrorCode};

/// Blank caller text is the same as no caller text.
pub(super) fn submitted(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// The agent a scratch-scope launch may run. The picker chooses it; the
/// catalog decides whether that choice is a supported, activated provider.
pub(super) async fn activated_provider(
    database: &DatabaseConnection,
    requested: Option<&str>,
) -> Result<String, LaunchAuthorityError> {
    let slug = submitted(requested).ok_or_else(|| {
        LaunchAuthorityError::unresolvable("An agent terminal launch requires a provider.")
    })?;
    Provider::try_from(slug)
        .map_err(|error| LaunchAuthorityError::unresolvable(error.to_string()))?;
    let row = provider::Entity::find()
        .filter(provider::Column::Slug.eq(slug))
        .one(database)
        .await?
        .ok_or_else(|| {
            LaunchAuthorityError::unresolvable(format!("Agent/provider '{slug}' is not supported."))
        })?;
    if !row.activated {
        return Err(LaunchAuthorityError::new(
            LaunchAuthorityErrorCode::PolicyRejected,
            format!("provider_not_activated: Agent/provider '{slug}' is not activated."),
        ));
    }
    Ok(row.slug)
}

pub(super) struct DefaultScratchLaunch {
    pub provider: String,
    pub model: Option<String>,
    pub reasoning: Option<String>,
}

/// Resolve a default-backed scratch launch from the catalog's validated global
/// default. The caller contributes no launch material, and a missing or
/// deactivated default is a refusal instead of an implicit provider fallback.
pub(super) async fn default_scratch_launch(
    database: &DatabaseConnection,
) -> Result<DefaultScratchLaunch, LaunchAuthorityError> {
    let default = read_global_launch_default(database).await?.ok_or_else(|| {
        LaunchAuthorityError::unresolvable(
            "Choose a default model in Settings before starting a conversation.",
        )
    })?;
    let provider = activated_provider(database, Some(&default.provider)).await?;
    Ok(DefaultScratchLaunch {
        provider,
        model: default.model,
        reasoning: default.reasoning,
    })
}

/// The module's linked local folder, as prompt text names it.
pub(super) async fn local_module_folder(
    database: &DatabaseConnection,
    module_id: &str,
) -> Option<String> {
    module_folder(database, module_id)
        .await
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| !path.is_empty())
}

/// The working and design directories this run is authorized to use.
pub(super) async fn launch_paths(
    paths: &LaunchPathsService,
    request: &CreateTerminalSession,
) -> Result<LaunchPathsView, LaunchAuthorityError> {
    let scope = match request.kind {
        TerminalLaunchKind::Task | TerminalLaunchKind::Automation => LaunchScope::Task,
        TerminalLaunchKind::Planning => LaunchScope::Plan,
        TerminalLaunchKind::Instant => LaunchScope::Instant,
        TerminalLaunchKind::DocumentChat => LaunchScope::Docchat,
        TerminalLaunchKind::Shell => {
            return Err(LaunchAuthorityError::unresolvable(
                "A shell launch has no design directory.",
            ))
        }
    };
    paths
        .resolve(LaunchPathsRequest {
            version: 1,
            scope,
            agent_run_id: request.agent_run_id(),
            project_id: request.project_id.clone(),
            module_id: Some(request.module_id.clone()),
            task_id: matches!(scope, LaunchScope::Task).then(|| request.issue_id.clone()),
            document_id: matches!(scope, LaunchScope::Docchat).then(|| request.issue_id.clone()),
        })
        .await
        .map_err(|error| LaunchAuthorityError::unresolvable(error.to_string()))
}
