use std::{path::PathBuf, sync::LazyLock};

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::dynamic::{Object, Schema, SchemaError},
    Builder, BuilderContext,
};

use super::commands::FoundationMutations;
use super::entities;
use super::error::{FoundationInitializationError, FoundationInitializationErrorCode};

static CONTEXT: LazyLock<BuilderContext> = LazyLock::new(BuilderContext::default);

pub fn foundation_schema(
    database: DatabaseConnection,
    worktracker_database: Option<DatabaseConnection>,
    worktracker_commands: Option<crate::work_management::commands::CommandDatabase>,
    attachment_storage: Option<crate::work_management::commands::attachments::AttachmentStorage>,
    settings_repository: Option<crate::settings_persistence::AppSettingRepository>,
    settings_stores: Option<crate::settings_persistence::SettingsStores>,
    readiness_data_directory: Option<PathBuf>,
) -> Result<Schema, FoundationInitializationError> {
    let mut builder = Builder::new(&CONTEXT, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);

    let builder = entities::register_entity_modules(builder);
    let builder = crate::work_management::schema::register(builder);
    let builder = crate::settings_persistence::schema::register(builder);
    let builder = crate::settings_persistence::register_profile_graphql(builder);
    let builder = crate::runs_persistence::register_graphql(builder);
    let mut builder = builder;
    builder.register_custom_mutation::<FoundationMutations>();
    let mut schema = builder.schema_builder().data(database);
    if let Some(worktracker_database) = worktracker_database {
        schema = schema.data(crate::runs_persistence::RunsServices::new(
            worktracker_database.clone(),
        ));
        schema = schema.data(crate::settings_persistence::ProviderCatalogService::new(
            worktracker_database.clone(),
        ));
        schema = schema.data(crate::work_management::read_queries::ReadDatabase(
            worktracker_database,
        ));
    }
    if let Some(worktracker_commands) = worktracker_commands {
        schema = schema.data(worktracker_commands);
    }
    if let Some(attachment_storage) = attachment_storage {
        schema = schema.data(attachment_storage);
    }
    if let Some(settings_repository) = settings_repository {
        schema = schema.data(settings_repository);
    }
    if let Some(settings_stores) = settings_stores {
        schema = schema.data(settings_stores);
    }
    if let Some(data_directory) = readiness_data_directory {
        schema = schema.extension(super::readiness_gate::Slice2CommandGate::new(
            data_directory,
        ));
    }
    schema.finish().map_err(schema_error)
}

fn schema_error(error: SchemaError) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::Schema,
        format!("could not build the GraphQL foundation schema: {error}"),
    )
}
