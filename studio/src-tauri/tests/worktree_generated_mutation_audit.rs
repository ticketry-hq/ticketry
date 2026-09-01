//! Audit of the complete generated Worktree GraphQL surface.
//!
//! The first test builds the deliberately unsafe schema that Seaography would
//! install if the Worktree mutation bundle were public, proving all four
//! generated writes arrive together in rc.9. The remaining tests prove the
//! shipping schema keeps that bundle private while serving the generated read
//! contract, and that protected columns cannot appear in any generated input.

use sea_orm::Database;
use seaography::{
    async_graphql::dynamic::{Object, Schema},
    Builder, BuilderContext,
};
use std::sync::LazyLock;
use ticketry_entities::work_management;
use ticketry_entities::worktree;
use ticketry_graphql_schema::generated_schema_sdl;
use ticketry_workspace_runtime::worktree::persistence::column_policy;
use ticketry_workspace_runtime::worktree::persistence::ownership_manifest::{
    GENERATED_MUTATION_GAPS, PROTECTED_COLUMNS,
};

/// The unprotected context: what Seaography installs with no Ticketry policy.
static AUDIT_CONTEXT: LazyLock<BuilderContext> = LazyLock::new(BuilderContext::default);

/// The shipping column policy, applied to an otherwise default context.
static PROTECTED_CONTEXT: LazyLock<BuilderContext> = LazyLock::new(|| {
    let mut context = BuilderContext::default();
    column_policy::apply(&mut context);
    context
});

async fn generated_crud_schema(context: &'static BuilderContext) -> Schema {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open generated CRUD audit database");
    let mut builder = Builder::new(context, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);

    // The Work Management read graph only satisfies the Worktree relations;
    // the audited bundle is the Worktree one.
    let builder = ticketry_terminal::register_persistence_graphql(builder);
    let mut builder = work_management::register_entity_modules(builder);
    seaography::register_entity!(builder, worktree);

    builder
        .schema_builder()
        .data(database)
        .finish()
        .expect("build generated CRUD audit schema")
}

/// The body of one input object in an SDL document.
fn input_block(sdl: &str, name: &str) -> String {
    let start = sdl
        .find(&format!("input {name} {{"))
        .unwrap_or_else(|| panic!("missing input {name}"));
    let rest = &sdl[start..];
    rest[..rest.find("\n}").expect("terminated input block")].to_owned()
}

#[tokio::test]
async fn audit_schema_blindly_enables_every_generated_worktree_bundle() {
    let sdl = generated_crud_schema(&AUDIT_CONTEXT).await.sdl();
    for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
        let field = format!("worktrees{operation}");
        assert!(
            sdl.contains(&field),
            "missing generated audit field {field}"
        );
    }
    // Every audited write would accept caller-submitted derived identity.
    assert!(sdl.contains("input WorktreesInsertInput"));
    assert!(sdl.contains("input WorktreesUpdateInput"));
    assert_eq!(GENERATED_MUTATION_GAPS.len(), 4);
}

#[tokio::test]
async fn shipping_schema_keeps_the_worktree_mutation_bundle_private() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");
    for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
        let field = format!("worktrees{operation}");
        assert!(
            !sdl.contains(&field),
            "shipping schema exposes generated {field}"
        );
    }
    assert!(!sdl.contains("WorktreesInsertInput"));
    assert!(!sdl.contains("WorktreesUpdateInput"));
}

#[tokio::test]
async fn shipping_schema_serves_the_generated_worktree_read_contract() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");
    for fragment in [
        "worktrees(filters: WorktreesFilterInput",
        "type Worktrees {",
        "pullRequestUrl: String",
        "type WorktreesConnection {",
        "type WorktreesEdge {",
        "input WorktreesFilterInput {",
        "input WorktreesHavingInput {",
        "input WorktreesOrderInput {",
        // Generated relations, not a mirrored DTO, carry Work Management scope.
        "issue: WorktrackerIssue",
        "project: WorktrackerProject",
    ] {
        assert!(sdl.contains(fragment), "missing generated read {fragment}");
    }
}

#[tokio::test]
async fn shipping_schema_exposes_only_explicit_pull_request_actions() {
    let sdl = generated_schema_sdl().await.expect("build shipping schema");

    for field in [
        "worktree_pull_request_create(",
        "module_checkout_pull_request_create(",
        "worktree_pull_request_replace(",
        "worktree_pull_request_follow_up(",
        "worktree_cleanup(",
        "worktree_pull_request_merge_prepare(",
    ] {
        assert!(sdl.contains(field), "missing pull-request action {field}");
    }
    assert!(!sdl.contains("worktreesUpdate("));
}

#[tokio::test]
async fn the_unprotected_bundle_would_publish_every_protected_column() {
    let sdl = generated_crud_schema(&AUDIT_CONTEXT).await.sdl();
    let insert = input_block(&sdl, "WorktreesInsertInput");
    let update = input_block(&sdl, "WorktreesUpdateInput");

    for column in PROTECTED_COLUMNS {
        let field = format!("\n\t{}:", camel(column));
        assert!(
            insert.contains(&field) && update.contains(&field),
            "audit expected the unprotected bundle to expose {column}"
        );
    }
}

#[tokio::test]
async fn the_central_column_policy_keeps_protected_columns_out_of_generated_inputs() {
    let sdl = generated_crud_schema(&PROTECTED_CONTEXT).await.sdl();
    let insert = input_block(&sdl, "WorktreesInsertInput");
    let update = input_block(&sdl, "WorktreesUpdateInput");

    for column in PROTECTED_COLUMNS {
        let field = format!("\n\t{}:", camel(column));
        assert!(
            !insert.contains(&field),
            "protected column {column} reached the generated insert input"
        );
        assert!(
            !update.contains(&field),
            "protected column {column} reached the generated update input"
        );
    }
    // Only the owning Work Item identity remains caller-supplied.
    assert!(insert.contains("\n\ttaskId:"));
    assert!(update.contains("\n\ttaskId:"));
}

#[test]
fn every_protected_column_exists_on_the_adopted_entity() {
    use sea_orm::{IdenStatic, Iterable};

    let columns = worktree::Column::iter()
        .map(|column| column.as_str())
        .collect::<Vec<_>>();
    for column in PROTECTED_COLUMNS {
        assert!(
            columns.contains(column),
            "protected column {column} is not on the Worktree entity"
        );
    }
}

fn camel(column: &str) -> String {
    let mut output = String::new();
    let mut upper = false;
    for character in column.chars() {
        if character == '_' {
            upper = true;
            continue;
        }
        if upper {
            output.extend(character.to_uppercase());
            upper = false;
        } else {
            output.push(character);
        }
    }
    output
}
