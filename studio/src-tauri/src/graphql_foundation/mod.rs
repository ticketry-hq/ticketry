mod commands;
mod composition;
mod database;
pub mod entities;
mod error;
pub mod migrations;
mod schema;

use std::path::Path;

pub use composition::{combine_with_native_handler, transport_api};
pub use error::{FoundationInitializationError, FoundationInitializationErrorCode};
use tauri_graphql::GraphQlEndpoint;

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
    let schema = schema::foundation_schema(database)?;
    Ok(FoundationRuntime {
        endpoint: GraphQlEndpoint::new(schema),
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

pub async fn generated_schema_sdl() -> Result<String, FoundationInitializationError> {
    let database = database::in_memory().await?;
    schema::foundation_schema(database).map(|schema| schema.sdl())
}

pub fn export_transport_bindings(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_graphql::export_bindings(path)
}
