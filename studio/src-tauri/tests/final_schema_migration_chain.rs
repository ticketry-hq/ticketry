use muxed_studio_lib::{
    graphql_foundation::{adopt_worktracker_and_install, InstallationOwnership},
    settings_persistence::provider_catalog_migrations,
    work_management::{
        final_schema_migrations, launch_binding_entry_skill_migration,
        module_presentation_migration, open_for_commands, project_onboarding_migration,
        workflow_color_migration, workspace_tab_order_migration,
    },
};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use tauri_graphql::TransportApiImpl;

#[path = "final_schema_migration_chain/support.rs"]
mod support;

use support::{assert_final, fixture, table_exists};

#[tokio::test]
async fn full_0044_through_0052_chain_is_lossless_and_reopens() {
    let (directory, database) = fixture().await;
    final_schema_migrations::install(&database)
        .await
        .expect("run the full chain");
    assert_final(&database).await;
    database.close().await.unwrap();

    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .expect("reopen migrated installation");
    final_schema_migrations::install(&reopened)
        .await
        .expect("repeat the full chain");
    assert_final(&reopened).await;
}

#[tokio::test]
async fn partial_prior_completion_resumes_without_replaying_completed_steps() {
    let (_directory, database) = fixture().await;
    provider_catalog_migrations::install_codex_5_6(&database)
        .await
        .unwrap();
    project_onboarding_migration::install(&database)
        .await
        .unwrap();
    final_schema_migrations::install(&database)
        .await
        .expect("resume the remaining chain");
    assert_final(&database).await;
}

#[tokio::test]
async fn a_pre_chain_snapshot_restores_and_migrates_to_the_same_leaf() {
    let (source_directory, source) = fixture().await;
    source.close().await.unwrap();
    let restored_directory = tempfile::tempdir().expect("create restore directory");
    std::fs::copy(
        source_directory.path().join("state.db"),
        restored_directory.path().join("state.db"),
    )
    .expect("restore the pre-chain snapshot");

    for path in [source_directory.path(), restored_directory.path()] {
        let database = open_for_commands(&path.join("state.db"))
            .await
            .expect("open snapshot copy");
        final_schema_migrations::install(&database)
            .await
            .expect("migrate snapshot copy");
        assert_final(&database).await;
    }
}

#[tokio::test]
async fn every_data_copy_uses_only_the_supplied_database() {
    let (_supplied_directory, supplied) = fixture().await;
    let (_other_directory, other) = fixture().await;

    final_schema_migrations::install(&supplied)
        .await
        .expect("migrate supplied database");
    assert_final(&supplied).await;

    assert!(table_exists(&other, "worktracker_workspace").await);
    assert!(!table_exists(&other, "worktracker_modulepresentation").await);
    let binding_columns = other
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(worktracker_launchbinding)".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect::<Vec<_>>();
    assert!(!binding_columns.iter().any(|name| name == "entry_skill"));
    let migrated_models = other
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM worktracker_agentmodel
             WHERE name LIKE 'gpt-5.6-%' OR name='gpt-5.3-codex-spark'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(migrated_models, 0);
}

#[tokio::test]
async fn fresh_production_entry_reaches_the_final_leaf() {
    let directory = tempfile::tempdir().expect("create empty installation");
    let api = TransportApiImpl::new();
    let adopted = adopt_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        directory.path(),
        &api,
        InstallationOwnership::Owned,
    )
    .await
    .expect("run the fresh production entry");
    let database = adopted.runtime.commands();
    final_schema_migrations::install(database)
        .await
        .expect("repeat the production chain");
    assert!(!table_exists(database, "worktracker_workspace").await);
    assert!(table_exists(database, "worktracker_modulepresentation").await);
    assert!(table_exists(database, "module_links").await);
    assert!(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .unwrap()
        .is_empty());
}

async fn run_step(database: &DatabaseConnection, step: usize) -> sea_orm::DbErr {
    let result = match step {
        0 => provider_catalog_migrations::install_codex_5_6(database).await,
        1 => project_onboarding_migration::install(database).await,
        2 => launch_binding_entry_skill_migration::install(database).await,
        3 => workflow_color_migration::install(database).await,
        4 => workspace_tab_order_migration::install(database).await,
        5 => module_presentation_migration::install(database).await,
        6 => provider_catalog_migrations::install_codex_spark(database).await,
        _ => unreachable!(),
    };
    result.expect_err("the injected step fault must stop the migration")
}

async fn complete_before(database: &DatabaseConnection, stop: usize) {
    if stop > 0 {
        provider_catalog_migrations::install_codex_5_6(database)
            .await
            .unwrap();
    }
    if stop > 1 {
        project_onboarding_migration::install(database)
            .await
            .unwrap();
    }
    if stop > 2 {
        launch_binding_entry_skill_migration::install(database)
            .await
            .unwrap();
    }
    if stop > 3 {
        workflow_color_migration::install(database).await.unwrap();
    }
    if stop > 4 {
        workspace_tab_order_migration::install(database)
            .await
            .unwrap();
    }
    if stop > 5 {
        module_presentation_migration::install(database)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn every_step_rolls_back_an_injected_failure_and_then_resumes() {
    let faults = [
        (
            "CREATE TRIGGER fail_step BEFORE INSERT ON worktracker_agentmodel WHEN NEW.name LIKE 'gpt-5.6-%' BEGIN SELECT RAISE(ABORT,'0044'); END",
            "DROP TRIGGER fail_step",
            provider_catalog_migrations::CODEX_5_6_LEDGER,
        ),
        (
            "CREATE TRIGGER fail_step BEFORE UPDATE ON worktracker_project BEGIN SELECT RAISE(ABORT,'0045'); END",
            "DROP TRIGGER fail_step",
            project_onboarding_migration::LEDGER_TABLE,
        ),
        (
            "CREATE VIEW ticketry_launch_binding_entry_skill_migration AS SELECT 1",
            "DROP VIEW ticketry_launch_binding_entry_skill_migration",
            launch_binding_entry_skill_migration::LEDGER_TABLE,
        ),
        (
            "CREATE VIEW ticketry_workflow_color_migration AS SELECT 1",
            "DROP VIEW ticketry_workflow_color_migration",
            workflow_color_migration::LEDGER_TABLE,
        ),
        (
            "CREATE VIEW ticketry_workspace_tab_order_migration AS SELECT 1",
            "DROP VIEW ticketry_workspace_tab_order_migration",
            workspace_tab_order_migration::LEDGER_TABLE,
        ),
        (
            "CREATE VIEW worktracker_modulepresentation AS SELECT 1",
            "DROP VIEW worktracker_modulepresentation",
            module_presentation_migration::LEDGER_TABLE,
        ),
        (
            "CREATE TRIGGER fail_step BEFORE INSERT ON worktracker_agentmodel WHEN NEW.name='gpt-5.3-codex-spark' BEGIN SELECT RAISE(ABORT,'0051'); END",
            "DROP TRIGGER fail_step",
            provider_catalog_migrations::CODEX_SPARK_LEDGER,
        ),
    ];

    for (step, (inject, clear, ledger)) in faults.into_iter().enumerate() {
        let (_directory, database) = fixture().await;
        complete_before(&database, step).await;
        database.execute_unprepared(inject).await.unwrap();
        let error = run_step(&database, step).await;
        assert!(!error.to_string().is_empty(), "step {step}");
        assert!(!table_exists(&database, ledger).await, "step {step}");
        database.execute_unprepared(clear).await.unwrap();
        final_schema_migrations::install(&database)
            .await
            .unwrap_or_else(|error| panic!("step {step} did not resume: {error}"));
        assert_final(&database).await;
    }
}
