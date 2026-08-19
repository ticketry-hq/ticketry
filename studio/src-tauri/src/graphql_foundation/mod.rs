mod composed_commands;
mod composition;
mod database;
pub use crate::entities::foundation as entities;
pub(crate) mod error;
pub mod migrations;
pub(crate) mod readiness_gate;

use std::path::Path;

pub use composed_commands::{AdoptedWorktracker, ComposedCommandRuntime};
pub use composition::{combine_with_native_handler, transport_api};
pub use error::{FoundationInitializationError, FoundationInitializationErrorCode};
use tauri_graphql::{GraphQlEndpoint, TransportApi};

pub struct FoundationRuntime {
    endpoint: GraphQlEndpoint,
}

impl FoundationRuntime {
    pub fn endpoint(&self) -> &GraphQlEndpoint {
        &self.endpoint
    }
}

pub async fn initialize(
    database_path: &Path,
) -> Result<FoundationRuntime, FoundationInitializationError> {
    let database = database::open(database_path).await?;
    let schema =
        crate::query_root::foundation_schema(
        database, None, None, None, None, None, None, None, None, None,
    )?;
    Ok(FoundationRuntime {
        endpoint: GraphQlEndpoint::new(schema),
    })
}

pub async fn initialize_with_worktracker_and_install(
    foundation_database_path: &Path,
    worktracker_database_path: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let foundation_database = database::open(foundation_database_path).await?;
    let worktracker_database = crate::work_management::open(worktracker_database_path)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                error.to_string(),
            )
        })?;
    let schema = crate::query_root::foundation_schema(
        foundation_database,
        Some(worktracker_database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::EndpointInstall,
                format!("could not install the GraphQL endpoint: {error}"),
            )
        })
}

pub async fn initialize_and_install(
    database_path: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let runtime = initialize(database_path).await?;
    api.install_endpoint(runtime.endpoint).map_err(|error| {
        FoundationInitializationError::new(
            FoundationInitializationErrorCode::EndpointInstall,
            format!("could not install the GraphQL foundation endpoint: {error}"),
        )
    })
}

pub async fn initialize_with_keybinding_settings_and_install(
    foundation_database_path: &Path,
    settings_database_path: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let foundation_database = database::open(foundation_database_path).await?;
    let settings_repository =
        crate::settings_persistence::AppSettingRepository::open(settings_database_path)
            .await
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?;
    let schema = crate::query_root::foundation_schema(
        foundation_database,
        None,
        None,
        None,
        Some(settings_repository),
        None,
        None,
        None,
        None,
        None,
    )?;
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::EndpointInstall,
                format!("could not install the GraphQL endpoint: {error}"),
            )
        })
}

/// Compose authored commands against an isolated writable WorkTracker store.
/// Shipping uses the checked initializer below, which adds the readiness gate.
pub async fn initialize_with_worktracker_commands_and_install(
    foundation_database_path: &Path,
    worktracker_database_path: &Path,
    media_root: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<ComposedCommandRuntime, FoundationInitializationError> {
    let settings_stores = media_root
        .parent()
        .map(crate::settings_persistence::SettingsStores::new)
        .ok_or_else(|| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                format!(
                    "the media root {} has no settings directory",
                    media_root.display()
                ),
            )
        })?;
    let composed = initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        worktracker_database_path,
        media_root,
        None,
        settings_stores.clone(),
        api,
    )
    .await?;
    Ok(ComposedCommandRuntime::new(composed, &settings_stores))
}

/// Compose and install the authored-command schema, handing back the command
/// connection it now owns so callers reuse it instead of opening another pool.
async fn initialize_with_worktracker_commands_and_install_inner(
    foundation_database_path: &Path,
    worktracker_database_path: &Path,
    media_root: &Path,
    readiness_data_directory: Option<&Path>,
    settings_stores: crate::settings_persistence::SettingsStores,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<composed_commands::ComposedWorktracker, FoundationInitializationError> {
    let foundation_database = database::open(foundation_database_path).await?;
    let worktracker_database = crate::work_management::open_for_commands(worktracker_database_path)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                error.to_string(),
            )
        })?;
    let settings_repository =
        crate::settings_persistence::AppSettingRepository::open(worktracker_database_path)
            .await
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?;
    if let Some(workspace) = crate::work_management::read_queries::workspace(&worktracker_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                error.to_string(),
            )
        })?
    {
        settings_stores
            .ensure_local_profile("Local", &workspace.slug)
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?;
    }
    // Where the durable outbox is adopted, authored writes publish their facts
    // through it. Before adoption the same commands run unchanged and publish
    // nothing, so composing this schema can never make a write depend on a
    // table that does not exist yet.
    let work_facts = crate::runs_persistence::outbox_adopted(&worktracker_database)
        .await
        .then(|| {
            crate::work_management::commands::status_facts::WorkFactRecorder::new(
                crate::runs_persistence::RunsServices::new(worktracker_database.clone())
                    .outbox()
                    .events()
                    .clone(),
            )
        });
    // Worktree operations own a Rust-authored journal, so installation is
    // idempotent rather than an adoption. A journal that cannot be installed
    // simply leaves creation uncomposed: the capability reports itself
    // unavailable instead of running Git without a recovery record.
    let worktrees = compose_worktree_operations(
        &worktracker_database,
        &settings_stores,
        work_facts.is_some(),
    )
    .await;
    // Document saves are Workspace Operations over the same journal. One
    // bounded pass finishes a rename a previous process staged and abandoned,
    // before any window can ask for that document again.
    let saves_reconciled =
        compose_document_saves(&worktracker_database, work_facts.is_some()).await;
    // Whether every startup pass completed. This is deliberately not "the
    // backlog is empty": an ambiguous document or repository is meant to stay
    // deferred without making unrelated ones unusable. What the readiness gate
    // needs to know is that the pass ran and finished, not that it had nothing
    // left to defer.
    let workspace_reconciled = worktrees.reconciled && saves_reconciled;
    let worktree_operations = worktrees.operations;
    // Documents is composed once, here, and shared. GraphQL reads the registry
    // through this service, the desktop asset protocol serves bytes through it,
    // and the watcher supervisor settles through it, so path authorization and
    // fact publication have exactly one implementation in the process.
    let documents = crate::documents::DocumentsService::new(
        worktracker_database.clone(),
        Some(settings_stores.profiles().clone()),
    )
    .publishing(document_facts(&worktracker_database).await);
    let document_watch = compose_document_watch(&documents).await;
    let schema = crate::query_root::foundation_schema(
        foundation_database,
        Some(worktracker_database.clone()),
        Some(crate::work_management::commands::CommandDatabase(
            worktracker_database.clone(),
        )),
        Some(crate::work_management::commands::attachments::AttachmentStorage::new(media_root)),
        Some(settings_repository),
        Some(settings_stores),
        readiness_data_directory.map(Path::to_path_buf),
        work_facts,
        worktree_operations,
        Some(documents.clone()),
    )?;
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::EndpointInstall,
                format!("could not install the GraphQL endpoint: {error}"),
            )
        })?;
    Ok(composed_commands::ComposedWorktracker {
        commands: worktracker_database,
        documents,
        document_watch,
        workspace_reconciled,
    })
}

/// The durable publisher registry settlements append their facts through.
///
/// Before the Runs outbox is adopted there is nowhere to append to, so
/// discovery reconciles exactly as it does afterwards and simply publishes
/// nothing. A caller's own response stays authoritative either way.
async fn document_facts(
    worktracker_database: &sea_orm::DatabaseConnection,
) -> Option<crate::documents::DocumentFactRecorder> {
    crate::runs_persistence::outbox_adopted(worktracker_database)
        .await
        .then(|| {
            crate::documents::DocumentFactRecorder::new(
                crate::runs_persistence::RunsServices::new(worktracker_database.clone())
                    .outbox()
                    .events()
                    .clone(),
            )
        })
}

/// Start live document discovery for the runs that are still active.
///
/// The first reconciliation runs before this returns, so a restart has
/// reconstructed its eligible watchers — and rescanned their roots for whatever
/// was written while Ticketry was down — before Studio can ask for a registry.
/// Supervision then continues in the background.
async fn compose_document_watch(
    documents: &crate::documents::DocumentsService,
) -> Option<crate::document_watch::DocumentWatchSupervisor> {
    let supervisor = crate::document_watch::DocumentWatchSupervisor::new(documents);
    if let Err(error) = supervisor.reconcile().await {
        // Live discovery is an optimization over rescanning, so failing to
        // start it degrades promptness rather than the capability.
        eprintln!("Ticketry could not start its document watchers: {error}");
        return None;
    }
    supervisor.supervise();
    Some(supervisor)
}

/// Compose the worktree write capabilities over the adopted store.
///
/// The Workspace Operation journal is Rust-authored, so installing it is
/// idempotent and repeatable rather than a handoff. Bounded reconciliation
/// passes run before the schema is reachable, so a creation, a discard, or a
/// landing abandoned by a previous process is adopted, completed, or recorded
/// as a conflict before a user can ask again. Every pass is bounded: whatever
/// it does not reach stays due, and a second pass is harmless.
///
/// Creation, discard, and integration are composed together because they are
/// the three stages of one checkout's life over one repository, and they share
/// the process-wide repository locks so none can observe another's
/// half-finished tree.
async fn compose_worktree_operations(
    worktracker_database: &sea_orm::DatabaseConnection,
    settings_stores: &crate::settings_persistence::SettingsStores,
    outbox_adopted: bool,
) -> ComposedWorktreeOperations {
    if let Err(error) = crate::workspace_operations::schema::install(worktracker_database).await {
        eprintln!("Ticketry could not install the Workspace Operation journal: {error}");
        return ComposedWorktreeOperations {
            operations: None,
            reconciled: false,
        };
    }
    let mut reconciled = true;
    let events = outbox_adopted.then(|| {
        crate::runs_persistence::RunsServices::new(worktracker_database.clone())
            .outbox()
            .events()
            .clone()
    });
    let journal =
        crate::workspace_operations::WorkspaceOperationJournal::new(worktracker_database.clone());
    let locks = crate::worktree_status::RepositoryLocks::shared();
    let create = crate::worktree_create::WorktreeCreateService::new(
        worktracker_database.clone(),
        settings_stores.profiles().clone(),
        journal.clone(),
        events.clone(),
        locks.clone(),
    );
    if let Err(error) = create.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned worktree operations: {error}");
        reconciled = false;
    }
    let discard = crate::worktree_discard::WorktreeDiscardService::new(
        worktracker_database.clone(),
        settings_stores.profiles().clone(),
        journal.clone(),
        events.clone(),
        locks.clone(),
    );
    // A discard abandoned mid-removal is finished here, so a stale row, a
    // pruned-but-unrecorded checkout, or an undeleted branch cannot survive a
    // restart as a permanent half-state.
    if let Err(error) = discard.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned worktree discards: {error}");
        reconciled = false;
    }
    let integrations_reconciled = compose_worktree_integrations(
        worktracker_database,
        settings_stores,
        journal,
        events,
        locks,
    )
    .await;
    ComposedWorktreeOperations {
        operations: Some(crate::worktree_operations::WorktreeOperations::new(
            create, discard,
        )),
        reconciled: reconciled && integrations_reconciled,
    }
}

/// The worktree write capabilities, and whether their startup reconciliation
/// passes finished. The two are returned together because the readiness gate
/// needs both: a composed capability whose backlog was never drained is not one
/// a window may be pointed at yet.
struct ComposedWorktreeOperations {
    operations: Option<crate::worktree_operations::WorktreeOperations>,
    reconciled: bool,
}

/// Finish, and then continue, the landings completed Work Items asked for.
///
/// Integration has no schema surface: nobody asks for it, so nothing about it
/// is published. What startup owes it is convergence — first the operations a
/// previous process abandoned mid-sequence, then the committed completions that
/// were never delivered at all, which is what a completion transitioned while
/// Ticketry was closed looks like.
async fn compose_worktree_integrations(
    worktracker_database: &sea_orm::DatabaseConnection,
    settings_stores: &crate::settings_persistence::SettingsStores,
    journal: crate::workspace_operations::WorkspaceOperationJournal,
    events: Option<crate::runs_persistence::StatusEventRepository>,
    locks: crate::worktree_status::RepositoryLocks,
) -> bool {
    // Before the Worktree index is adopted there is no checkout to land and no
    // row to remove, so integration composes to nothing rather than querying a
    // table this store does not have yet. Nothing to reconcile is a completed
    // pass, not a failed one.
    if !crate::worktree_persistence::worktrees_adopted(worktracker_database).await {
        return true;
    }
    let mut reconciled = true;
    let integrations = crate::worktree_integrate::WorktreeIntegrateService::new(
        worktracker_database.clone(),
        settings_stores.profiles().clone(),
        journal,
        events,
        locks,
    );
    if let Err(error) = integrations.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned worktree integrations: {error}");
        reconciled = false;
    }
    if let Err(error) = integrations
        .deliver_pending(crate::worktree_integrate::MAX_DELIVERY_BATCH)
        .await
    {
        eprintln!("Ticketry could not deliver completed worktree integrations: {error}");
        reconciled = false;
    }
    reconciled
}

/// Drain abandoned document saves over the adopted store.
///
/// A save that was staged, or renamed, and never settled is finished here
/// before the schema is reachable, so the first window to open a document sees
/// one file version and one recorded digest. The pass is bounded and
/// idempotent: whatever it does not reach stays due, and a second pass is
/// harmless. A journal that cannot be installed simply leaves saving
/// uncomposed rather than replacing a file without a recovery record.
async fn compose_document_saves(
    worktracker_database: &sea_orm::DatabaseConnection,
    outbox_adopted: bool,
) -> bool {
    if let Err(error) = crate::workspace_operations::schema::install(worktracker_database).await {
        eprintln!("Ticketry could not install the Workspace Operation journal: {error}");
        return false;
    }
    let facts = outbox_adopted.then(|| {
        crate::documents::DocumentFactRecorder::new(
            crate::runs_persistence::RunsServices::new(worktracker_database.clone())
                .outbox()
                .events()
                .clone(),
        )
    });
    let service = crate::documents::save::DocumentSaveService::new(
        worktracker_database.clone(),
        crate::workspace_operations::WorkspaceOperationJournal::new(worktracker_database.clone()),
        facts,
    );
    if let Err(error) = service.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned document saves: {error}");
        return false;
    }
    true
}

/// Perform the checked one-writer handoff before exposing authored commands.
pub async fn adopt_worktracker_and_install(
    foundation_database_path: &Path,
    data_directory: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<AdoptedWorktracker, FoundationInitializationError> {
    crate::settings_persistence::preflight(data_directory)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                error.to_string(),
            )
        })?;
    let evidence = crate::work_management::adoption::adopt(data_directory)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                error.to_string(),
            )
        })?;
    let provider_database =
        crate::work_management::open_for_commands(&data_directory.join("state.db"))
            .await
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?;
    crate::settings_persistence::ProviderCatalogService::open(provider_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                error.to_string(),
            )
        })?;
    crate::settings_persistence::adopt(data_directory)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                error.to_string(),
            )
        })?;
    // The Runs write lease changes hands here, before any Rust Runs command is
    // reachable. An unknown or corrupt Runs schema refuses adoption and leaves
    // the pre-cutover snapshot restorable.
    crate::runs_persistence::preflight(data_directory)
        .await
        .map_err(runs_adoption_error)?;
    crate::runs_persistence::adopt(data_directory)
        .await
        .map_err(runs_adoption_error)?;
    // The Documents and Worktrees write leases change hands here, after Runs
    // because document and worktree facts are appended to the Runs outbox, and
    // before any workspace command is composed. An unknown or malformed
    // Documents, Worktree, or journal schema refuses the handoff and leaves the
    // pre-cutover snapshots restorable.
    crate::workspace_handoff::adopt(data_directory)
        .await
        .map_err(workspace_adoption_error)?;
    // Build the local settings stores here, not inside composition, so the
    // adopted runtime hands out the very instance the schema mutates.
    let settings_stores = crate::settings_persistence::SettingsStores::new(data_directory);
    let composed = initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        &data_directory.join("state.db"),
        &data_directory.join("media"),
        Some(data_directory),
        settings_stores.clone(),
        api,
    )
    .await?;
    verify_graphql_readiness(api).await?;
    Ok(AdoptedWorktracker {
        evidence,
        runtime: ComposedCommandRuntime::new(composed, &settings_stores),
    })
}

fn workspace_adoption_error(
    error: crate::workspace_handoff::WorkspaceHandoffError,
) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
        format!(
            "Documents and Worktrees adoption failed ({}): {error}",
            error.code_str()
        ),
    )
}

fn runs_adoption_error(
    error: crate::runs_persistence::RunsPersistenceError,
) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
        format!("Runs adoption failed ({}): {error}", error.code_str()),
    )
}

async fn verify_graphql_readiness(
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let response = api
        .clone()
        .graphql_execute(
            serde_json::json!({"query": "query Slice2Readiness { __typename }"}).to_string(),
        )
        .await;
    let value: serde_json::Value = serde_json::from_str(&response).map_err(|error| {
        FoundationInitializationError::new(
            FoundationInitializationErrorCode::EndpointInstall,
            format!("could not decode the Slice 2 GraphQL readiness probe: {error}"),
        )
    })?;
    if value.get("errors").is_some() || value.pointer("/data/__typename").is_none() {
        return Err(FoundationInitializationError::new(
            FoundationInitializationErrorCode::EndpointInstall,
            "Slice 2 GraphQL readiness probe did not return a query root",
        ));
    }
    Ok(())
}

pub async fn generated_schema_sdl() -> Result<String, FoundationInitializationError> {
    let database = database::in_memory().await?;
    crate::query_root::foundation_schema(
        database, None, None, None, None, None, None, None, None, None,
    )
        .map(|schema| schema.sdl())
}

pub async fn initialize_with_profile_settings_and_install(
    foundation_database_path: &Path,
    data_directory: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let foundation_database = database::open(foundation_database_path).await?;
    let schema = crate::query_root::foundation_schema(
        foundation_database,
        None,
        None,
        None,
        None,
        Some(crate::settings_persistence::SettingsStores::new(
            data_directory,
        )),
        None,
        None,
        None,
        None,
    )?;
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::EndpointInstall,
                format!("could not install the GraphQL endpoint: {error}"),
            )
        })
}

pub fn export_transport_bindings(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_graphql::export_bindings(path)
}
