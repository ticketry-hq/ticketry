mod composed_commands;
mod composition;
mod database;
pub(crate) mod entity_registration;
pub(crate) mod generated_mutations;
pub use crate::entities::foundation as entities;
pub(crate) mod error;
pub mod migrations;
pub(crate) mod readiness_gate;

use std::path::Path;

pub use composed_commands::{AdoptedWorktracker, ComposedCommandRuntime};
pub use composition::{combine_with_native_handler, transport_api};
pub use error::{FoundationInitializationError, FoundationInitializationErrorCode};
use tauri_graphql::{GraphQlEndpoint, TransportApi};

/// Whether this process owns the installation it is about to serve.
///
/// The desktop and browser adapter both own the installation they serve.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallationOwnership {
    /// This process holds the installation lease and adopts.
    Owned,
}

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
    let schema = crate::query_root::foundation_schema_with_terminal_services(
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
    let schema = crate::query_root::foundation_schema_with_terminal_services(
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
    let schema = crate::query_root::foundation_schema_with_terminal_services(
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
    let composed = initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        worktracker_database_path,
        media_root,
        None,
        api,
    )
    .await?;
    Ok(ComposedCommandRuntime::new(composed))
}

/// Compose and install the authored-command schema, handing back the command
/// connection it now owns so callers reuse it instead of opening another pool.
async fn initialize_with_worktracker_commands_and_install_inner(
    foundation_database_path: &Path,
    worktracker_database_path: &Path,
    media_root: &Path,
    readiness_data_directory: Option<&Path>,
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
    crate::work_management::workflow_color_migration::install(&worktracker_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                format!("could not adopt reviewed workflow-state colors: {error}"),
            )
        })?;
    crate::work_management::workspace_tab_order_migration::install(&worktracker_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                format!("could not install workspace-tab ordering: {error}"),
            )
        })?;
    crate::work_management::module_presentation_migration::install(&worktracker_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                format!("could not install module presentation: {error}"),
            )
        })?;
    crate::work_management::project_onboarding_migration::install(&worktracker_database)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
                format!("could not move onboarding onto the project: {error}"),
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
    let worktrees =
        compose_worktree_operations(&worktracker_database, work_facts.is_some()).await;
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
    let documents = crate::documents::DocumentsService::new(worktracker_database.clone())
        .publishing(document_facts(&worktracker_database).await);
    let document_watch = compose_document_watch(&documents).await;
    let viewer_ownership =
        crate::viewer_ownership::ViewerOwnershipService::new(worktracker_database.clone());
    let terminal_runtime = crate::terminal::lifecycle::InteractiveTerminalLaunchRuntime::new();
    let terminal_services = Some(crate::query_root::TerminalServices {
        launch: crate::terminal::launch::TerminalLaunchService::new(
            worktracker_database.clone(),
            std::sync::Arc::new(terminal_runtime.clone()),
        )
        .with_authority(std::sync::Arc::new(
            crate::launch::authority::LaunchAuthorityService::new(worktracker_database.clone()),
        )),
        viewers: viewer_ownership.clone(),
        output_activity: crate::terminal::output_activity::TerminalOutputActivityService::production(
            worktracker_database.clone(),
        ),
    });
    let schema = crate::query_root::foundation_schema_with_terminal_services(
        foundation_database,
        Some(worktracker_database.clone()),
        Some(crate::work_management::commands::CommandDatabase(
            worktracker_database.clone(),
        )),
        Some(crate::work_management::commands::attachments::AttachmentStorage::new(media_root)),
        Some(settings_repository),
        readiness_data_directory.map(Path::to_path_buf),
        work_facts,
        worktree_operations,
        Some(documents.clone()),
        terminal_services.clone(),
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
        viewer_ownership,
        terminal_runtime,
        output_activity: terminal_services
            .as_ref()
            .expect("terminal services were composed")
            .output_activity
            .clone(),
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
) -> Option<crate::documents::watch::DocumentWatchSupervisor> {
    let supervisor = crate::documents::watch::DocumentWatchSupervisor::new(documents);
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
    outbox_adopted: bool,
) -> ComposedWorktreeOperations {
    if let Err(error) = crate::workspace::operations::schema::install(worktracker_database).await {
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
        crate::workspace::operations::WorkspaceOperationJournal::new(worktracker_database.clone());
    let locks = crate::worktree::status::RepositoryLocks::shared();
    let create = crate::worktree::create::WorktreeCreateService::new(
        worktracker_database.clone(),
        journal.clone(),
        events.clone(),
        locks.clone(),
    );
    if let Err(error) = create.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned worktree operations: {error}");
        reconciled = false;
    }
    let discard = crate::worktree::discard::WorktreeDiscardService::new(
        worktracker_database.clone(),
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
    let integrations_reconciled =
        compose_worktree_integrations(worktracker_database, journal, events, locks).await;
    ComposedWorktreeOperations {
        operations: Some(crate::worktree::operations::WorktreeOperations::new(
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
    operations: Option<crate::worktree::operations::WorktreeOperations>,
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
    journal: crate::workspace::operations::WorkspaceOperationJournal,
    events: Option<crate::runs_persistence::StatusEventRepository>,
    locks: crate::worktree::status::RepositoryLocks,
) -> bool {
    // Before the Worktree index is adopted there is no checkout to land and no
    // row to remove, so integration composes to nothing rather than querying a
    // table this store does not have yet. Nothing to reconcile is a completed
    // pass, not a failed one.
    if !crate::worktree::persistence::worktrees_adopted(worktracker_database).await {
        return true;
    }
    let mut reconciled = true;
    let integrations = crate::worktree::integrate::WorktreeIntegrateService::new(
        worktracker_database.clone(),
        journal,
        events,
        locks,
    );
    if let Err(error) = integrations.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned worktree integrations: {error}");
        reconciled = false;
    }
    if let Err(error) = integrations
        .deliver_pending(crate::worktree::integrate::MAX_DELIVERY_BATCH)
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
    if let Err(error) = crate::workspace::operations::schema::install(worktracker_database).await {
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
        crate::workspace::operations::WorkspaceOperationJournal::new(worktracker_database.clone()),
        facts,
    );
    if let Err(error) = service.reconciler().reconcile().await {
        eprintln!("Ticketry could not reconcile abandoned document saves: {error}");
        return false;
    }
    true
}

/// Import legacy profile module folders into typed Module Link rows.
///
/// The importer is handed a connection opened against this installation's own
/// state database. It never resolves the established data directory itself, so
/// an import cannot reach an installation the caller did not name.
async fn import_module_links(data_directory: &Path) -> Result<(), FoundationInitializationError> {
    let database = crate::work_management::open_for_commands(&data_directory.join("state.db"))
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::ModuleLinkImport,
                error.to_string(),
            )
        })?;
    let outcome = crate::module_links::import(&database, data_directory)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::ModuleLinkImport,
                error.to_string(),
            )
        });
    let _ = database.close().await;
    outcome.map(drop)
}

/// Perform the checked one-writer handoff before exposing authored commands.
pub async fn adopt_worktracker_and_install(
    foundation_database_path: &Path,
    data_directory: &Path,
    api: &tauri_graphql::TransportApiImpl,
    ownership: InstallationOwnership,
) -> Result<AdoptedWorktracker, FoundationInitializationError> {
    // The installation itself changes hands first. Nothing below may touch a
    // database whose ownership has not transferred: the capability handoffs
    // write, and a write before the verified recovery snapshot exists is the
    // one step of this migration that cannot be undone.
    //
    let installation = match ownership {
        InstallationOwnership::Owned => Some(
            crate::installation::adoption::adopt(data_directory)
                .await
                .map_err(installation_adoption_error)?,
        ),
    };
    crate::settings_persistence::preflight(data_directory)
        .await
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::SettingsDatabaseOpen,
                error.to_string(),
            )
        })?;
    crate::work_management::adoption::adopt(data_directory)
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
    // Typed Module Links are imported once the settings store is Rust-owned
    // and its profile snapshot is verified, so the rows commit while their
    // legacy source is still recoverable. The import is idempotent: every
    // later launch re-runs it and changes nothing.
    import_module_links(data_directory).await?;
    // The Runs write lease changes hands here, before any Rust Runs command is
    // reachable. An unknown or corrupt Runs schema refuses adoption and leaves
    // the pre-cutover snapshot restorable.
    crate::runs_persistence::preflight(data_directory)
        .await
        .map_err(runs_adoption_error)?;
    crate::runs_persistence::adopt(data_directory)
        .await
        .map_err(runs_adoption_error)?;
    // Terminal persistence depends on the adopted Agent Run and Launch Effect
    // identities. Refuse an unknown Terminal leaf before the product schema or
    // any Rust terminal writer becomes reachable.
    crate::terminal::persistence::preflight(data_directory)
        .await
        .map_err(terminal_adoption_error)?;
    crate::terminal::persistence::adopt(data_directory)
        .await
        .map_err(terminal_adoption_error)?;
    // Execution campaigns depend on adopted Work Management, Runs, and
    // Terminal identities. Classify and validate them only after those three
    // stores are ready, and before any future Graph Run command is composed.
    crate::execution::persistence::preflight(data_directory)
        .await
        .map_err(execution_adoption_error)?;
    crate::execution::persistence::adopt(data_directory)
        .await
        .map_err(execution_adoption_error)?;
    // The Documents and Worktrees write leases change hands here, after Runs
    // because document and worktree facts are appended to the Runs outbox, and
    // before any workspace command is composed. An unknown or malformed
    // Documents, Worktree, or journal schema refuses the handoff and leaves the
    // pre-cutover snapshots restorable.
    crate::workspace::handoff::adopt(data_directory)
        .await
        .map_err(workspace_adoption_error)?;
    // Every capability has handed over, so the durable status-event ledger the
    // boundary is published into now exists. Readiness opens here, after the
    // last handoff and before the endpoint is installed, because the endpoint
    // is what makes a mutation reachable.
    if let Some(installation) = installation {
        crate::installation::adoption::open_readiness(data_directory, installation)
            .await
            .map_err(installation_adoption_error)?;
    }
    let composed = initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        &data_directory.join("state.db"),
        &data_directory.join("media"),
        Some(data_directory),
        api,
    )
    .await?;
    verify_graphql_readiness(api).await?;
    Ok(AdoptedWorktracker {
        runtime: ComposedCommandRuntime::new(composed),
    })
}

fn installation_adoption_error(
    error: crate::installation::adoption::AdoptionFailure,
) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
        format!("{error}. {}", error.recovery()),
    )
}

fn workspace_adoption_error(
    error: crate::workspace::handoff::WorkspaceHandoffError,
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

fn terminal_adoption_error(
    error: crate::terminal::persistence::TerminalPersistenceError,
) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
        format!("Terminal adoption failed ({}): {error}", error.code_str()),
    )
}

fn execution_adoption_error(
    error: crate::execution::persistence::ExecutionPersistenceError,
) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::WorktrackerDatabaseOpen,
        format!("Execution adoption failed: {error}"),
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
    crate::query_root::generated_contract_schema(database).map(|schema| schema.sdl())
}

pub fn export_transport_bindings(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_graphql::export_bindings(path)
}
