//! Deliberately unsafe generated-CRUD schema used only to audit which
//! WorkTracker entity bundles can replace authored mutations.

use std::sync::LazyLock;

use sea_orm::Database;
use seaography::{
    async_graphql::dynamic::{Object, Schema},
    Builder, BuilderContext,
};
use ticketry_entities::work_management::{
    agent_model, agent_model_reasoning_level, attachment, issue, issue_blocker, issue_type,
    issue_type_transition, launch_binding, module_presentation, project, provider, reasoning_level,
    state,
};

static AUDIT_CONTEXT: LazyLock<BuilderContext> = LazyLock::new(BuilderContext::default);

async fn generated_crud_schema() -> Schema {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open generated CRUD audit database");
    let mut builder = Builder::new(&AUDIT_CONTEXT, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);

    let mut builder = muxed_studio_lib::terminal::persistence::register_graphql(builder);
    seaography::register_entity!(builder, project);
    seaography::register_entity!(builder, state);
    seaography::register_entity!(builder, issue_type);
    seaography::register_entity!(builder, issue);
    seaography::register_entity!(builder, module_presentation);
    seaography::register_entity!(builder, issue_blocker);
    seaography::register_entity!(builder, attachment);
    seaography::register_entity!(builder, issue_type_transition);
    seaography::register_entity!(builder, launch_binding);
    seaography::register_entity!(builder, provider);
    seaography::register_entity!(builder, agent_model);
    seaography::register_entity!(builder, agent_model_reasoning_level);
    seaography::register_entity!(builder, reasoning_level);

    builder
        .schema_builder()
        .data(database)
        .finish()
        .expect("build generated CRUD audit schema")
}

#[tokio::test]
async fn audit_schema_blindly_enables_every_generated_worktracker_bundle() {
    let sdl = generated_crud_schema().await.sdl();
    for entity in [
        "worktrackerProject",
        "worktrackerState",
        "worktrackerIssuetype",
        "worktrackerIssue",
        "worktrackerModulepresentation",
        "worktrackerIssueBlockedBy",
        "worktrackerAttachment",
        "worktrackerIssuetypetransition",
        "worktrackerLaunchbinding",
        "worktrackerProvider",
        "worktrackerAgentmodel",
        "worktrackerAgentmodelreasoninglevel",
        "worktrackerReasoninglevel",
    ] {
        for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
            let field = format!("{entity}{operation}");
            assert!(
                sdl.contains(&field),
                "missing generated audit field {field}"
            );
        }
    }
}
