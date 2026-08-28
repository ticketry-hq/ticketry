//! Deliberately unsafe generated-CRUD schema used only to audit the Design
//! Document mutation bundle.
//!
//! Seaography rc.9 installs create-one, create-batch, update, and delete
//! together, so the four are judged together. This schema is what registering
//! the bundle would publish; the reasons each operation is unsafe are recorded
//! in `documents::persistence::generated_mutation_audit`, and
//! `design_document_graphql.rs` proves none of it reaches the composed schema.

use std::sync::LazyLock;

use muxed_studio_lib::documents::persistence::generated_mutation_audit::FINDINGS;
use muxed_studio_lib::entities::documents::design_document;
use sea_orm::Database;
use seaography::{
    async_graphql::dynamic::{Object, Schema},
    Builder, BuilderContext,
};

static AUDIT_CONTEXT: LazyLock<BuilderContext> = LazyLock::new(BuilderContext::default);

async fn generated_crud_schema() -> Schema {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open generated CRUD audit database");
    let mut builder = Builder::new(&AUDIT_CONTEXT, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);

    seaography::register_entity!(builder, design_document);

    builder
        .schema_builder()
        .data(database)
        .finish()
        .expect("build generated CRUD audit schema")
}

#[tokio::test]
async fn the_audit_schema_exposes_every_generated_design_document_write() {
    let sdl = generated_crud_schema().await.sdl();

    for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
        let field = format!("designDocuments{operation}");
        assert!(
            sdl.contains(&field),
            "missing generated audit field {field}"
        );
    }
}

#[tokio::test]
async fn every_audited_field_is_one_the_bundle_actually_installs() {
    let sdl = generated_crud_schema().await.sdl();

    assert_eq!(
        FINDINGS.len(),
        4,
        "all four writes must be audited together"
    );
    for finding in FINDINGS {
        assert!(
            sdl.contains(finding.field),
            "audited field {} is not a generated field",
            finding.field
        );
        assert!(!finding.missing_behaviour.is_empty());
        assert!(!finding.regression_test.is_empty());
    }
}

#[tokio::test]
async fn the_authority_columns_stay_out_of_the_contract_even_when_writes_are_enabled() {
    let sdl = generated_crud_schema().await.sdl();

    // `#[seaography(ignore)]` is structural: the absolute authorized root and
    // the discovering run's identity are absent from the object, the filters,
    // the ordering, and every generated input — even in this unsafe schema.
    assert!(!sdl.contains("rootDir"), "rootDir leaked into the contract");
    assert!(
        !sdl.contains("discoveredByRunId"),
        "discoveredByRunId leaked into the contract"
    );
    assert!(sdl.contains("relPath"), "the read contract lost relPath");
}
