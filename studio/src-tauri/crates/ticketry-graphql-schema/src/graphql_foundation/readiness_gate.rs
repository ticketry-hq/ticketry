use std::{path::PathBuf, sync::Arc};

use seaography::async_graphql::{
    extensions::{Extension, ExtensionContext, ExtensionFactory, NextParseQuery},
    parser::types::{ExecutableDocument, OperationType},
    ServerError, ServerResult, Variables,
};

/// Rejects GraphQL mutations until the complete Slice 2 readiness result has
/// been published. Queries remain available for the startup health probe.
pub struct Slice2CommandGate {
    data_directory: PathBuf,
}

impl Slice2CommandGate {
    pub fn new(data_directory: PathBuf) -> Self {
        Self { data_directory }
    }
}

impl ExtensionFactory for Slice2CommandGate {
    fn create(&self) -> Arc<dyn Extension> {
        Arc::new(Slice2CommandGateExtension {
            data_directory: self.data_directory.clone(),
        })
    }
}

struct Slice2CommandGateExtension {
    data_directory: PathBuf,
}

#[async_trait::async_trait]
impl Extension for Slice2CommandGateExtension {
    async fn parse_query(
        &self,
        ctx: &ExtensionContext<'_>,
        query: &str,
        variables: &Variables,
        next: NextParseQuery<'_>,
    ) -> ServerResult<ExecutableDocument> {
        let document = next.run(ctx, query, variables).await?;
        let contains_mutation = document
            .operations
            .iter()
            .any(|(_, operation)| operation.node.ty == OperationType::Mutation);
        if contains_mutation
            && !ticketry_settings::published_readiness_is_complete(&self.data_directory)
        {
            let mut error =
                ServerError::new("Slice 2 is not ready; GraphQL commands are disabled", None);
            let mut extensions = seaography::async_graphql::ErrorExtensionValues::default();
            extensions.set("code", "service_unavailable");
            extensions.set("phase", "runtime-reconciliation");
            error.extensions = Some(extensions);
            return Err(error);
        }
        Ok(document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use seaography::async_graphql::{EmptySubscription, Object, Schema};

    struct Query;

    #[Object]
    impl Query {
        async fn ping(&self) -> &'static str {
            "pong"
        }
    }

    struct Mutation;

    #[Object]
    impl Mutation {
        async fn command(&self) -> bool {
            true
        }
    }

    #[tokio::test]
    async fn mutations_open_only_after_complete_readiness_is_published() {
        let directory = tempfile::tempdir().expect("create command gate directory");
        let schema = Schema::build(Query, Mutation, EmptySubscription)
            .extension(Slice2CommandGate::new(directory.path().to_path_buf()))
            .finish();

        assert!(schema.execute("query { ping }").await.errors.is_empty());
        assert!(!schema
            .execute("mutation { command }")
            .await
            .errors
            .is_empty());

        let unavailable = schema.execute("mutation { command }").await;
        assert_eq!(
            unavailable.errors[0]
                .extensions
                .as_ref()
                .and_then(|values| values.get("code")),
            Some(&seaography::async_graphql::Value::from(
                "service_unavailable"
            ))
        );

        ticketry_settings::publish_readiness(
            directory.path(),
            &ticketry_settings::Slice2Readiness::complete(),
        )
        .expect("publish complete readiness");
        assert!(schema
            .execute("mutation { command }")
            .await
            .errors
            .is_empty());
    }
}
