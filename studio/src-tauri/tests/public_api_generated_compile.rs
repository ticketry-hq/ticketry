//! Compiler authority for the generated entity namespace exception.
//! Run through the shipping workspace; source parsing alone cannot prove derives.
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, Iterable, ModelTrait, PrimaryKeyTrait};

fn entity_contract<E: EntityTrait>() {
    fn active<A: ActiveModelTrait>() {}
    fn model<M: ModelTrait>() {}
    fn column<C: ColumnTrait>() {}
    fn primary_key<P: PrimaryKeyTrait>() {}
    active::<E::ActiveModel>();
    model::<E::Model>();
    column::<E::Column>();
    primary_key::<E::PrimaryKey>();
}

macro_rules! prove_namespace {
    ($($namespace:ident),+ $(,)?) => { $(
        entity_contract::<ticketry_entities::$namespace::Entity>();
        let _: Option<ticketry_entities::$namespace::Model> = None;
        let _: Option<ticketry_entities::$namespace::ActiveModel> = None;
        let _: Option<ticketry_entities::$namespace::Column> = None;
        let _: Option<ticketry_entities::$namespace::PrimaryKey> = None;
        let _: Option<ticketry_entities::$namespace::ModelEx> = None;
        let _: Option<ticketry_entities::$namespace::ActiveModelEx> = None;
        let _: Option<ticketry_entities::$namespace::Relation> = None;
        let _: Option<ticketry_entities::$namespace::RelatedEntity> = None;
        let _: Option<ticketry_entities::$namespace::TypedColumn> = None;
        let _: Option<ticketry_entities::$namespace::EntityLoader> = None;
        let _: Option<ticketry_entities::$namespace::EntityReverse> = None;
        let _: Option<ticketry_entities::$namespace::EntityLoaderWith> = None;
        let _: Option<ticketry_entities::$namespace::EntityLoaderNest> = None;
        let _: ticketry_entities::$namespace::TypedColumn = ticketry_entities::$namespace::COLUMN;
        {
            fn loader_parameter<P: ticketry_entities::$namespace::EntityLoaderWithParam>() {}
            let _: fn() = loader_parameter::<ticketry_entities::$namespace::Relation>;
        }
    )+ };
}

#[test]
fn retained_generated_namespaces_compile_with_relations_and_seaography() {
    let macro_package = include_str!("../Cargo.lock")
        .split("[[package]]")
        .find(|package| {
            package
                .lines()
                .any(|line| line == "name = \"sea-orm-macros\"")
        })
        .expect("the generated namespace handling requires the pinned framework package");
    assert!(
        macro_package
            .lines()
            .any(|line| line == "version = \"2.0.1\""),
        "review generated descendant handling when the SeaORM macro version changes"
    );
    assert!(
        macro_package.lines().any(|line| {
            line == "source = \"registry+https://github.com/rust-lang/crates.io-index\""
        }),
        "a patched macro package needs explicit expansion handling and compiler evidence"
    );
    prove_namespace!(
        design_document,
        agent_execution,
        graph_run,
        launch_claim,
        migration_probes,
        agent_run,
        automation_attempt,
        launch_effect,
        project_compaction_watermark,
        status_event,
        app_settings,
        module_link,
        cleanup_effect,
        launch_material,
        session,
        viewer_lease,
        agent_model,
        agent_model_reasoning_level,
        attachment,
        issue,
        issue_blocker,
        issue_label,
        issue_type,
        issue_type_transition,
        label,
        launch_binding,
        launch_policy_decision,
        launch_policy_rejection,
        module_presentation,
        project,
        provider,
        reasoning_level,
        sprint,
        sprint_goal,
        sprint_suggestion,
        state,
        transition_occurrence,
        operation,
        ship_record,
        worktree,
    );
    assert!(ticketry_entities::issue::Relation::iter().next().is_some());
    // These assignments compile the actual Seaography assembly caller signatures.
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_work_management_entities;
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_document_entities;
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_execution_entities;
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_workspace_runtime_entities;
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_worktree_entities;
    let _: fn(seaography::Builder) -> seaography::Builder =
        ticketry_entities::register_foundation_entities;
}
