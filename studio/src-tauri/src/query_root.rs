use std::{path::PathBuf, sync::LazyLock};

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::dynamic::{Object, Schema, SchemaError},
    Builder, BuilderContext,
};

mod context;
mod mutations;
pub mod queries;
pub mod types;

use crate::entities::foundation as entities;
use crate::graphql_foundation::error::{
    FoundationInitializationError, FoundationInitializationErrorCode,
};

static CONTEXT: LazyLock<BuilderContext> = LazyLock::new(context::builder_context);

pub fn foundation_schema(
    database: DatabaseConnection,
    worktracker_database: Option<DatabaseConnection>,
    worktracker_commands: Option<crate::work_management::commands::CommandDatabase>,
    attachment_storage: Option<crate::work_management::commands::attachments::AttachmentStorage>,
    settings_repository: Option<crate::settings_persistence::AppSettingRepository>,
    settings_stores: Option<crate::settings_persistence::SettingsStores>,
    readiness_data_directory: Option<PathBuf>,
    work_facts: Option<crate::work_management::commands::status_facts::WorkFactRecorder>,
    worktree_operations: Option<crate::worktree_operations::WorktreeOperations>,
    documents: Option<crate::documents::DocumentsService>,
) -> Result<Schema, FoundationInitializationError> {
    // Seaography has one generated-entity connection per schema. Product
    // schemas therefore use WorkTracker's state.db; the disposable foundation
    // database remains the connection only for the isolated probe schema.
    let entity_database = worktracker_database
        .clone()
        .unwrap_or_else(|| database.clone());
    let mut builder = Builder::new(&CONTEXT, entity_database.clone());
    builder.mutation = Object::new("Mutation");
    // The Runs status stream registers the only subscription field, so the
    // subscription root is always populated.
    builder.schema = Schema::build("Query", Some("Mutation"), Some("Subscription"));

    // `migration_probes` belongs only to the disposable foundation database.
    // Seaography generated resolvers use this builder connection, so registering
    // it in a product schema would publish its CRUD bundle against state.db.
    let builder = if worktracker_database.is_none() {
        entities::register_entity_modules(builder)
    } else {
        builder
    };
    let builder = crate::entities::work_management::register_entity_modules(builder);
    let builder = crate::worktree_persistence::register_graphql(builder);
    let builder = crate::worktree_status::register_graphql(builder);
    let builder = crate::worktree_create::register_graphql(builder);
    let builder = crate::worktree_discard::register_graphql(builder);
    let builder = queries::register(builder);
    let builder = crate::settings_persistence::schema::register(builder);
    let builder = crate::settings_persistence::register_profile_graphql(builder);
    let builder = crate::runs_persistence::register_graphql(builder);
    let builder = crate::documents_persistence::register_graphql(builder);
    let builder = crate::documents::register_graphql(builder);
    let mut schema = builder.schema_builder().data(entity_database);
    // Document discovery reconciles the registry against the filesystem, so it
    // needs the same WorkTracker store the rows live in. The selected profile
    // is optional: without it a rescan still converges on every root the
    // registry and the bucket's Agent Runs already name.
    //
    // Composition supplies the service where it built one, so the watcher
    // supervisor, the desktop asset protocol, and GraphQL share one boundary
    // and one publisher rather than three that agree by coincidence.
    // The publisher a document save appends through. It is the composed
    // Documents service's own recorder where composition built one, so a save
    // and a discovery publish through one seam; otherwise it is derived from
    // the same outbox adoption every authored write already keys on.
    let document_facts = documents
        .as_ref()
        .and_then(|documents| documents.facts().cloned())
        .or_else(|| {
            let work_items = worktracker_database.as_ref()?;
            work_facts.is_some().then(|| {
                crate::documents::DocumentFactRecorder::new(
                    crate::runs_persistence::RunsServices::new(work_items.clone())
                        .outbox()
                        .events()
                        .clone(),
                )
            })
        });
    if let Some(documents) = documents {
        schema = schema.data(documents);
    } else if let Some(work_items) = &worktracker_database {
        schema = schema.data(crate::documents::DocumentsService::new(
            work_items.clone(),
            settings_stores
                .as_ref()
                .map(|stores| stores.profiles().clone()),
        ));
    }
    // Saving a document is a Workspace Operation over the same registry rows,
    // so it needs that store and the publisher discovery already uses. The
    // journal is Rust-authored, so a composition holding one WorkTracker
    // connection has everything the capability needs; without one the mutation
    // reports itself unavailable rather than writing a file.
    if let Some(work_items) = &worktracker_database {
        schema = schema.data(crate::documents::save::DocumentSaveService::new(
            work_items.clone(),
            crate::workspace_operations::WorkspaceOperationJournal::new(work_items.clone()),
            document_facts,
        ));
    }
    // Live worktree status needs both halves of its trusted input: the Work
    // Item graph that says who owns a checkout, and the selected profile that
    // says where that module lives. Without both there is nothing to derive
    // from, so the query reports itself unavailable rather than guessing.
    // Creation, when it is composed, publishes the status reader it already
    // shares its repository locks with, so both capabilities serialize on the
    // same lock rather than opening two independent sets.
    if let Some(worktree_operations) = &worktree_operations {
        schema = schema.data(worktree_operations.status_service().clone());
    } else if let (Some(work_items), Some(settings_stores)) =
        (&worktracker_database, &settings_stores)
    {
        schema = schema.data(crate::worktree_status::WorktreeStatusService::new(
            work_items.clone(),
            settings_stores.profiles().clone(),
        ));
    }
    // Each write publishes itself, so a resolver reaches its own service and
    // never the other's. They are composed as a pair only so they share one
    // set of repository locks.
    if let Some(worktree_operations) = worktree_operations {
        schema = schema.data(worktree_operations.create().clone());
        schema = schema.data(worktree_operations.discard().clone());
    }
    if let Some(worktracker_database) = worktracker_database {
        let runs = crate::runs_persistence::RunsServices::new(worktracker_database.clone());
        // The subscription reads through its own narrow datum so it cannot
        // reach a command service from the resolver context.
        schema = schema.data(runs.stream().clone());
        schema = schema.data(runs);
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
    // Authored writes publish durable facts only where the outbox has been
    // adopted. A composition without it still enforces every invariant.
    if let Some(work_facts) = work_facts {
        schema = schema.data(work_facts);
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
        // Runs status and Runs commands consult their own gate, because the
        // Slice 3 handoff completes after the Slice 2 one and must not open
        // merely because settings ownership did.
        schema = schema.data(crate::runs_persistence::RunsReadinessGate::watching(
            &data_directory,
        ));
        // Documents and Worktrees consult a third gate for the same reason: the
        // Slice 4 handoff completes after both earlier ones, and it must not
        // open merely because settings or Runs ownership did.
        schema = schema.data(
            crate::workspace_handoff::WorkspaceReadinessGate::watching(&data_directory),
        );
        schema = schema.extension(
            crate::graphql_foundation::readiness_gate::Slice2CommandGate::new(data_directory),
        );
    }
    schema.finish().map_err(schema_error)
}

fn schema_error(error: SchemaError) -> FoundationInitializationError {
    FoundationInitializationError::new(
        FoundationInitializationErrorCode::Schema,
        format!("could not build the GraphQL foundation schema: {error}"),
    )
}
