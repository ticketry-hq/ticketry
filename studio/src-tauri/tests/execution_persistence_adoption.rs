mod common;

use std::path::Path;

use common::execution_django_fixture as fixture;
use muxed_studio_lib::execution_persistence::{self, SourceClassification};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

#[tokio::test]
async fn every_supported_execution_leaf_adopts_twice_without_row_drift() {
    for leaf in fixture::LEAVES {
        let directory = tempfile::tempdir().expect("create Execution leaf fixture");
        fixture::migrate_leaf(directory.path(), leaf);
        assert_eq!(
            execution_persistence::preflight(directory.path())
                .await
                .unwrap_or_else(|error| panic!("{leaf} must classify: {error}")),
            SourceClassification::Django(leaf),
        );
        let first = execution_persistence::adopt(directory.path())
            .await
            .unwrap_or_else(|error| panic!("{leaf} must adopt: {error}"));
        let second = execution_persistence::adopt(directory.path())
            .await
            .unwrap_or_else(|error| panic!("{leaf} must reopen: {error}"));
        assert_eq!(first.tables, second.tables, "{leaf} changed after reopen");
        assert_eq!(
            execution_persistence::preflight(directory.path())
                .await
                .unwrap(),
            SourceClassification::RustOwned,
        );
    }
}

#[tokio::test]
async fn adoption_preserves_campaign_identity_history_and_policy() {
    let directory = tempfile::tempdir().expect("create Execution adoption fixture");
    fixture::provision_current(directory.path());
    muxed_studio_lib::runs_persistence::adopt(directory.path())
        .await
        .expect("adopt Runs before campaign claims");

    let first = execution_persistence::adopt(directory.path())
        .await
        .unwrap();
    let second = execution_persistence::adopt(directory.path())
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
        fixture::provision_current(directory.path());
        fixture::mutate(directory.path(), mutation);
        execution_persistence::preflight(directory.path())
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
