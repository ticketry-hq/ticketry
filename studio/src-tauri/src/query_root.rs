use std::{path::PathBuf, sync::LazyLock};

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::dynamic::{Object, Schema, SchemaError},
    Builder, BuilderContext,
};

mod context;

use crate::graphql_foundation::error::{
    FoundationInitializationError, FoundationInitializationErrorCode,
};

static CONTEXT: LazyLock<BuilderContext> = LazyLock::new(context::builder_context);

#[derive(Clone)]
pub struct TerminalServices {
    pub launch: crate::terminal::launch::TerminalLaunchService,
    pub viewers: crate::viewer_ownership::ViewerOwnershipService,
    pub output_activity: crate::terminal::output_activity::TerminalOutputActivityService,
}

#[derive(Clone, Copy)]
struct EntityContract {
    foundation_entities: bool,
    product_generated_mutations: bool,
}

pub fn foundation_schema(
    database: DatabaseConnection,
    worktracker_database: Option<DatabaseConnection>,
    worktracker_commands: Option<crate::work_management::commands::CommandDatabase>,
    attachment_storage: Option<crate::work_management::commands::attachments::AttachmentStorage>,
    settings_repository: Option<crate::settings_persistence::AppSettingRepository>,
    readiness_data_directory: Option<PathBuf>,
    work_facts: Option<crate::work_management::commands::status_facts::WorkFactRecorder>,
    worktree_operations: Option<crate::worktree::operations::WorktreeOperations>,
    documents: Option<crate::documents::DocumentsService>,
) -> Result<Schema, FoundationInitializationError> {
    foundation_schema_with_terminal_services(
        database,
        worktracker_database,
        worktracker_commands,
        attachment_storage,
        settings_repository,
        readiness_data_directory,
        work_facts,
        worktree_operations,
        documents,
        None,
    )
}

pub(crate) fn foundation_schema_with_terminal_services(
    database: DatabaseConnection,
    worktracker_database: Option<DatabaseConnection>,
    worktracker_commands: Option<crate::work_management::commands::CommandDatabase>,
    attachment_storage: Option<crate::work_management::commands::attachments::AttachmentStorage>,
    settings_repository: Option<crate::settings_persistence::AppSettingRepository>,
    readiness_data_directory: Option<PathBuf>,
    work_facts: Option<crate::work_management::commands::status_facts::WorkFactRecorder>,
    worktree_operations: Option<crate::worktree::operations::WorktreeOperations>,
    documents: Option<crate::documents::DocumentsService>,
    terminal_services: Option<TerminalServices>,
) -> Result<Schema, FoundationInitializationError> {
    let contract = EntityContract {
        foundation_entities: worktracker_database.is_none(),
        product_generated_mutations: worktracker_database.is_some(),
    };
    build_schema(
        database,
        worktracker_database,
        worktracker_commands,
        attachment_storage,
        settings_repository,
        readiness_data_directory,
        work_facts,
        worktree_operations,
        documents,
        terminal_services,
        contract,
        None,
    )
}

pub(crate) fn generated_contract_schema(
    database: DatabaseConnection,
) -> Result<Schema, FoundationInitializationError> {
    build_schema(
        database.clone(),
        Some(database),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        EntityContract {
            foundation_entities: true,
            product_generated_mutations: true,
        },
        None,
    )
}

pub(crate) fn keybinding_settings_schema(
    database: DatabaseConnection,
    settings_database: DatabaseConnection,
    settings_repository: crate::settings_persistence::AppSettingRepository,
) -> Result<Schema, FoundationInitializationError> {
    build_schema(
        database,
        None,
        None,
        None,
        Some(settings_repository),
        None,
        None,
        None,
        None,
        None,
        EntityContract {
            foundation_entities: true,
            product_generated_mutations: false,
        },
        Some(settings_database),
    )
}

fn build_schema(
    database: DatabaseConnection,
    worktracker_database: Option<DatabaseConnection>,
    worktracker_commands: Option<crate::work_management::commands::CommandDatabase>,
    attachment_storage: Option<crate::work_management::commands::attachments::AttachmentStorage>,
    settings_repository: Option<crate::settings_persistence::AppSettingRepository>,
    readiness_data_directory: Option<PathBuf>,
    work_facts: Option<crate::work_management::commands::status_facts::WorkFactRecorder>,
    worktree_operations: Option<crate::worktree::operations::WorktreeOperations>,
    documents: Option<crate::documents::DocumentsService>,
    terminal_services: Option<TerminalServices>,
    contract: EntityContract,
    entity_database_override: Option<DatabaseConnection>,
) -> Result<Schema, FoundationInitializationError> {
    // Seaography has one generated-entity connection per schema. Product
    // schemas therefore use WorkTracker's state.db; the disposable foundation
    // database remains the connection only for the isolated probe schema.
    let entity_database = entity_database_override.unwrap_or_else(|| {
        worktracker_database
            .clone()
            .unwrap_or_else(|| database.clone())
    });
    let graph_run_service = match (worktracker_database.as_ref(), terminal_services.as_ref()) {
        (Some(work_items), Some(terminals)) => {
            Some(crate::graph_run_service::GraphRunService::production(
                work_items.clone(),
                crate::work_management::launch_policy::LaunchPolicyResolver::new(
                    work_items.clone(),
                ),
                terminals.launch.clone(),
            ))
        }
        _ => None,
    };
    let run_now_service = match (worktracker_database.as_ref(), terminal_services.as_ref()) {
        (Some(work_items), Some(terminals)) => Some(crate::execution::run_now::RunNowService::new(
            work_items.clone(),
            crate::work_management::launch_policy::LaunchPolicyResolver::new(work_items.clone()),
            terminals.launch.clone(),
            work_facts.clone(),
        )),
        _ => None,
    };
    let mut builder = Builder::new(&CONTEXT, entity_database.clone());
    builder.mutation = Object::new("Mutation");
    // The Runs status stream registers the only subscription field, so the
    // subscription root is always populated.
    builder.schema = Schema::build("Query", Some("Mutation"), Some("Subscription"));

    // `migration_probes` belongs only to the disposable foundation database.
    // Seaography generated resolvers use this builder connection, so registering
    // it in a product schema would publish its generated write against state.db.
    let builder = if contract.foundation_entities {
        crate::graphql_foundation::entity_registration::register_entity_modules(builder)
    } else {
        builder
    };
    let builder = crate::entities::work_management::register_entity_modules(builder);
    let builder = if contract.product_generated_mutations {
        crate::entities::execution::register_entity_modules(builder)
    } else {
        builder
    };
    let builder = if contract.product_generated_mutations {
        crate::work_management::graphql::register_model_mutations(builder)
    } else {
        builder
    };
    // The Module Link is Rust-authored and lives in the same store, so its
    // generated read graph and its one restricted write register alongside the
    // WorkTracker entities they name.
    let builder = crate::module_links::register_graphql(builder);
    let builder = crate::worktree::persistence::register_graphql(builder);
    let builder = crate::worktree::status::register_graphql(builder);
    let builder = crate::worktree::changes::register_graphql(builder);
    let builder = crate::workspace::worktree::register_graphql(builder);
    let builder = crate::work_management::graphql::register(builder);
    let builder = crate::settings_persistence::schema::register(builder);
    let builder = crate::runs::register_graphql(builder);
    let builder = crate::terminal::persistence::register_graphql(builder);
    let builder = crate::terminal::instant_run_ticket::register_graphql(builder);
    let builder = crate::terminal::resume::register_graphql(builder);
    let builder = crate::terminal::launch::register_graphql(builder);
    let builder = crate::terminal::cleanup::register_graphql(builder);
    let builder = crate::terminal::session::register_graphql(builder);
    let builder = crate::execution::run_now::register_graphql(builder);
    let builder = if contract.product_generated_mutations {
        crate::execution::graph_run::register_graphql(builder)
    } else {
        builder
    };
    let builder = crate::terminal::viewer_lease::register_graphql(builder);
    let builder = crate::documents::persistence::register_graphql(builder);
    let builder = crate::workspace::design_document::register_graphql(builder);
    let builder = crate::documents::register_graphql(builder);
    let mut schema = builder.schema_builder().data(entity_database);
    if contract.product_generated_mutations {
        schema = schema.data(crate::graph_run_service::GraphRunCaller);
    }
    if let Some(graph_run_service) = graph_run_service {
        schema = schema.data(graph_run_service);
    }
    if let Some(run_now_service) = run_now_service {
        schema = schema.data(run_now_service);
    }
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
        schema = schema.data(crate::documents::DocumentsService::new(work_items.clone()));
    }
    // Saving a document is a Workspace Operation over the same registry rows,
    // so it needs that store and the publisher discovery already uses. The
    // journal is Rust-authored, so a composition holding one WorkTracker
    // connection has everything the capability needs; without one the mutation
    // reports itself unavailable rather than writing a file.
    if let Some(work_items) = &worktracker_database {
        schema = schema.data(crate::documents::save::DocumentSaveService::new(
            work_items.clone(),
            crate::workspace::operations::WorkspaceOperationJournal::new(work_items.clone()),
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
    let worktree_changes = if let Some(worktree_operations) = &worktree_operations {
        let changes = worktree_operations
            .changes_service()
            .publishing(work_facts.clone());
        schema = schema.data(worktree_operations.status_service().clone());
        schema = schema.data(changes.clone());
        Some(changes)
    } else if let Some(work_items) = &worktracker_database {
        let status = crate::worktree::status::WorktreeStatusService::new(work_items.clone());
        let changes = crate::worktree::changes::WorktreeChangesService::from_status(status.clone())
            .publishing(work_facts.clone());
        schema = schema.data(changes.clone());
        schema = schema.data(status);
        Some(changes)
    } else {
        None
    };
    if let (Some(changes), Some(terminals), Some(work_items)) = (
        worktree_changes,
        terminal_services.as_ref(),
        worktracker_database.as_ref(),
    ) {
        schema = schema.data(crate::worktree::changes::MergePreparationService::new(
            changes,
            std::sync::Arc::new(
                crate::execution::merge_preparation_launcher::TerminalMergePreparationLauncher::new(
                    work_items.clone(),
                    terminals.launch.clone(),
                ),
            ),
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
        schema = schema.data(crate::terminal::cleanup::TerminalCleanupService::with_tmux(
            worktracker_database.clone(),
        ));
        let runs = crate::runs_persistence::RunsServices::new(worktracker_database.clone());
        schema = schema.data(
            terminal_services
                .as_ref()
                .map(|services| services.output_activity.clone())
                .unwrap_or_else(|| {
                    crate::terminal::output_activity::TerminalOutputActivityService::production(
                        worktracker_database.clone(),
                    )
                }),
        );
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
        if let Some(terminal_services) = terminal_services {
            schema = schema.data(terminal_services.launch);
            schema = schema.data(terminal_services.viewers);
        } else {
            schema = schema.data(crate::viewer_ownership::ViewerOwnershipService::new(
                worktracker_commands.0.clone(),
            ));
        }
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
        schema = schema.data(crate::workspace::handoff::WorkspaceReadinessGate::watching(
            &data_directory,
        ));
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
