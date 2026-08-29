mod common;

use std::path::Path;

use common::execution_legacy_fixture as fixture;
use muxed_studio_lib::execution::persistence::{self, SourceClassification};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

#[tokio::test]
async fn fresh_database_without_execution_history_installs_rust_schema_idempotently() {
    let directory = tempfile::tempdir().expect("create fresh Execution fixture");
    let database = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open fresh state database");
    database
        .execute_unprepared(
            "CREATE TABLE django_migrations (\
             id integer PRIMARY KEY AUTOINCREMENT, app varchar(255) NOT NULL, \
             name varchar(255) NOT NULL, applied datetime NOT NULL); \
             CREATE TABLE worktracker_project (id char(32) PRIMARY KEY); \
             CREATE TABLE worktracker_issue (id char(32) PRIMARY KEY, type varchar(16), \
             project_id char(32), parent_id char(32)); \
             CREATE TABLE agent_runs (id varchar(255) PRIMARY KEY)",
        )
        .await
        .expect("install Django migration ledger");
    database.close().await.expect("close fresh state database");

    assert_eq!(
        persistence::preflight(directory.path())
            .await
            .expect("empty Execution history has a named bridge"),
        SourceClassification::Django(persistence::EMPTY_DJANGO_LEAF),
    );
    let first = persistence::adopt(directory.path())
        .await
        .expect("fresh Execution history adopts");
    let second = persistence::adopt(directory.path())
        .await
        .expect("fresh Execution schema reopens");
    assert_eq!(first.tables, second.tables);
    assert!(second.tables.values().all(|table| table.row_count == 0));
    assert_eq!(
        persistence::preflight(directory.path())
            .await
            .expect("installed Execution schema classifies"),
        SourceClassification::RustOwned,
    );
}

#[tokio::test]
async fn every_supported_execution_leaf_adopts_twice_without_row_drift() {
    for leaf in fixture::LEAVES {
        let directory = tempfile::tempdir().expect("create Execution leaf fixture");
        fixture::migrate_leaf(directory.path(), leaf).await;
        assert_eq!(
            persistence::preflight(directory.path())
                .await
                .unwrap_or_else(|error| panic!("{leaf} must classify: {error}")),
            SourceClassification::Django(leaf),
        );
        let first = persistence::adopt(directory.path())
            .await
            .unwrap_or_else(|error| panic!("{leaf} must adopt: {error}"));
        let second = persistence::adopt(directory.path())
            .await
            .unwrap_or_else(|error| panic!("{leaf} must reopen: {error}"));
        assert_eq!(first.tables, second.tables, "{leaf} changed after reopen");
        assert_eq!(
            persistence::preflight(directory.path())
                .await
                .unwrap(),
            SourceClassification::RustOwned,
        );
    }
}

#[tokio::test]
async fn adoption_preserves_campaign_identity_history_and_policy() {
    let directory = tempfile::tempdir().expect("create Execution adoption fixture");
    fixture::provision_current(directory.path()).await;
    muxed_studio_lib::runs_persistence::adopt(directory.path())
        .await
        .expect("adopt Runs before campaign claims");

    let first = persistence::adopt(directory.path())
        .await
        .unwrap();
    let second = persistence::adopt(directory.path())
        .await
        .unwrap();
    assert_eq!(first.tables, second.tables);
    assert_eq!(second.tables["graph_runs"].row_count, 2);
    assert_eq!(second.tables["launched_tasks"].row_count, 1);
    assert_eq!(second.tables["launch_policy_effects"].row_count, 1);

    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    let graph = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT root_id, project_id, module_id, agent, execution_mode, json_extract(launch_configuration,'$.policy_version') AS policy_version, created_at, updated_at FROM graph_runs WHERE root_id='{}'", fixture::SERIAL_ROOT),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(graph.try_get::<String>("", "agent").unwrap(), "codex");
    assert_eq!(
        graph.try_get::<String>("", "execution_mode").unwrap(),
        "serial"
    );
    assert_eq!(graph.try_get::<i32>("", "policy_version").unwrap(), 1);
    let claim = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT claim_id, agent_run_id, launch_effect_id, launch_generation, launched_at FROM launched_tasks".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        claim.try_get::<String>("", "agent_run_id").unwrap(),
        fixture::CLAIMED_AGENT_RUN
    );
    assert_eq!(
        claim.try_get::<String>("", "launched_at").unwrap(),
        fixture::CLAIMED_LAUNCHED_AT
    );
    assert_eq!(claim.try_get::<i64>("", "launch_generation").unwrap(), 1);
    assert_eq!(claim.try_get::<String>("", "claim_id").unwrap().len(), 32);
    assert_eq!(
        claim
            .try_get::<String>("", "launch_effect_id")
            .unwrap()
            .len(),
        32
    );
}

#[tokio::test]
async fn an_active_claim_is_adopted_when_its_runtime_names_the_child_in_either_form() {
    let directory = tempfile::tempdir().expect("create active Execution fixture");
    fixture::provision_current(directory.path()).await;
    muxed_studio_lib::runs_persistence::adopt(directory.path())
        .await
        .expect("adopt Runs before campaign claims");
    muxed_studio_lib::terminal::persistence::adopt(directory.path())
        .await
        .expect("adopt Terminal before campaign claims");
    // A real installation's Terminal Sessions carry the hyphenated Work Item
    // identity Django wrote, while the campaign ledger carries the compact one.
    // Both name the same child, so an active claim must still be adoptable.
    fixture::mutate(
        directory.path(),
        &format!(
            "UPDATE agent_runs SET ended_at=NULL WHERE id='{run}'; \
             INSERT INTO agent_terminal_sessions \
                 (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, \
                  scope, runtime_namespace) \
             VALUES ('{run}', 'pt-{run}', '{child}', '{module}', '{project}', \
                 '2026-08-19 17:30:00', 'task', 'tmux-adoption');",
            run = fixture::CLAIMED_AGENT_RUN,
            child = hyphenated(fixture::CLAIMED_CHILD),
            module = hyphenated(fixture::MODULE),
            project = hyphenated(fixture::PROJECT),
        ),
    )
    .await;

    let evidence = persistence::adopt(directory.path())
        .await
        .expect("an active claim whose runtime names the same child is adoptable");
    assert_eq!(evidence.tables["launched_tasks"].row_count, 1);
    assert_eq!(
        persistence::preflight(directory.path())
            .await
            .unwrap(),
        SourceClassification::RustOwned,
    );
}

fn hyphenated(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .expect("fixture identities are UUIDs")
        .hyphenated()
        .to_string()
}

#[tokio::test]
async fn preflight_refuses_schema_policy_identity_and_runtime_drift_before_writes() {
    for (label, mutation) in [
        ("column", "ALTER TABLE graph_runs ADD COLUMN surprise text"),
        ("constraint", "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=substr(sql,1,length(sql)-1) || ', CHECK (agent <> ''forbidden''))' WHERE type='table' AND name='graph_runs'; PRAGMA writable_schema=OFF"),
        ("mode", "UPDATE graph_runs SET execution_mode='recursive'"),
        ("policy", "PRAGMA ignore_check_constraints=ON; UPDATE graph_runs SET launch_configuration='not-json'"),
        ("root", "PRAGMA foreign_keys=OFF; UPDATE graph_runs SET root_id='missing-root' WHERE root_id='00000000000000000000000000089306'"),
        ("module", "UPDATE graph_runs SET module_id=(SELECT task_id FROM launched_tasks)"),
        ("child", "UPDATE launched_tasks SET task_id=(SELECT root_id FROM graph_runs)"),
        ("run", "UPDATE launched_tasks SET agent_run_id='missing-run'"),
        ("timestamp", "UPDATE launched_tasks SET launched_at='not-a-time'"),
        ("runtime", "UPDATE agent_runs SET ended_at=NULL WHERE id='run-893'"),
    ] {
        let directory = tempfile::tempdir().expect("create rejected Execution fixture");
        fixture::provision_current(directory.path()).await;
        fixture::mutate(directory.path(), mutation).await;
        persistence::preflight(directory.path())
            .await
            .expect_err(label);
        assert!(!ledger_exists(directory.path()).await, "{label} wrote adoption ledger");
    }
}

async fn ledger_exists(directory: &Path) -> bool {
    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        directory.join("state.db").display()
    ))
    .await
    .unwrap();
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='ticketry_execution_adoption'".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    row.try_get::<i64>("", "count").unwrap() == 1
}
