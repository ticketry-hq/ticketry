use std::sync::LazyLock;

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
) -> Result<Schema, FoundationInitializationError> {
    let mut builder = Builder::new(&CONTEXT, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);

    let builder = entities::register_entity_modules(builder);
    let mut builder = builder;
    builder.register_custom_mutation::<FoundationMutations>();
    builder
        .schema_builder()
        .data(database)
        .finish()
        .map_err(schema_error)
}

fn schema_error(error: SchemaError) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::Schema,
        format!("could not build the GraphQL foundation schema: {error}"),
    )
}
