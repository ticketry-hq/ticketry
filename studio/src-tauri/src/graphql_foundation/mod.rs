mod commands;
mod composition;
mod database;
pub mod entities;
mod error;
pub mod migrations;
mod readiness_gate;
mod schema;

use std::path::Path;

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
    let schema = schema::foundation_schema(database, None, None, None, None, None, None)?;
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
    let schema = schema::foundation_schema(
        foundation_database,
        Some(worktracker_database),
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
    let schema = schema::foundation_schema(
        foundation_database,
        None,
        None,
        None,
        Some(settings_repository),
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
) -> Result<(), FoundationInitializationError> {
    initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        worktracker_database_path,
        media_root,
        None,
        api,
    )
    .await
}

async fn initialize_with_worktracker_commands_and_install_inner(
    foundation_database_path: &Path,
    worktracker_database_path: &Path,
    media_root: &Path,
    readiness_data_directory: Option<&Path>,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
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
    let settings_stores = media_root
        .parent()
        .map(crate::settings_persistence::SettingsStores::new);
    if let (Some(stores), Some(workspace)) = (
        settings_stores.as_ref(),
        crate::work_management::read_queries::workspace(&worktracker_database)
            .await
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?,
    ) {
        stores
            .ensure_local_profile("Local", &workspace.slug)
            .map_err(|error| {
                FoundationInitializationError::new(
                    FoundationInitializationErrorCode::SettingsDatabaseOpen,
                    error.to_string(),
                )
            })?;
    }
    let schema = schema::foundation_schema(
        foundation_database,
        Some(worktracker_database.clone()),
        Some(crate::work_management::commands::CommandDatabase(
            worktracker_database,
        )),
        Some(crate::work_management::commands::attachments::AttachmentStorage::new(media_root)),
        Some(settings_repository),
        settings_stores,
        readiness_data_directory.map(Path::to_path_buf),
    )?;
    api.install_endpoint(GraphQlEndpoint::new(schema))
        .map_err(|error| {
            FoundationInitializationError::new(
                FoundationInitializationErrorCode::EndpointInstall,
                format!("could not install the GraphQL endpoint: {error}"),
            )
        })
}

/// Perform the checked one-writer handoff before exposing authored commands.
pub async fn adopt_worktracker_and_install(
    foundation_database_path: &Path,
    data_directory: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<crate::work_management::adoption::AdoptionEvidence, FoundationInitializationError> {
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
    initialize_with_worktracker_commands_and_install_inner(
        foundation_database_path,
        &data_directory.join("state.db"),
        &data_directory.join("media"),
        Some(data_directory),
        api,
    )
    .await?;
    verify_graphql_readiness(api).await?;
    Ok(evidence)
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
    schema::foundation_schema(database, None, None, None, None, None, None)
        .map(|schema| schema.sdl())
}

pub async fn initialize_with_profile_settings_and_install(
    foundation_database_path: &Path,
    data_directory: &Path,
    api: &tauri_graphql::TransportApiImpl,
) -> Result<(), FoundationInitializationError> {
    let foundation_database = database::open(foundation_database_path).await?;
    let schema = schema::foundation_schema(
        foundation_database,
        None,
        None,
        None,
        None,
        Some(crate::settings_persistence::SettingsStores::new(
            data_directory,
        )),
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
