//! The authoritative sources a launch is resolved from: the provider catalog,
//! the selected profile's module folder, and the run's derived directories.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};

use crate::entities::work_management::provider;
use crate::launch::paths::{LaunchPathsRequest, LaunchPathsService, LaunchPathsView, LaunchScope};
use crate::launch::planning::Provider;
use crate::settings_persistence::ProfileStore;
use crate::terminal::launch::{CreateTerminalSession, TerminalLaunchKind};
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

/// The module's configured local folder, as prompt text names it.
pub(super) fn local_module_folder(profiles: &ProfileStore, module_id: &str) -> Option<String> {
    module_folder(profiles, module_id)
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
