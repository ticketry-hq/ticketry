//! The Slice 3 ownership handoff, from the outside.
//!
//! These cases assert what an operator can observe about the cutover: the
//! checked manifest covers exactly the tables adoption installs, a partially
//! ready runtime refuses rather than degrading, adoption refuses an unknown
//! schema before the write lease changes hands, and the published record
//! states that no Django write fallback exists.

use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_runs::{
    self, adopt, owned_run_tables, preflight, publish_readiness, published_readiness_is_complete,
    RunsReadinessGate, Slice3Readiness, ADOPTED_TABLES, RUN_OWNED_AUTHORED_TABLES,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

/// A Django-shaped store at the current leaf, built by the real migrations so
/// adoption takes its production path rather than a shortcut this test wrote.
fn django_fixture(path: &Path) {
    let script = r#"
import os, sys, uuid
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
call_command('migrate', interactive=False, verbosity=0)
"#;
    let output = Command::new(root().join("backend/.venv/bin/python"))
        .arg("-c")
        .arg(script)
        .arg(path)
        .current_dir(root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn open(path: &Path) -> sea_orm::DatabaseConnection {
    Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap()
}

#[tokio::test]
async fn the_manifest_names_exactly_the_tables_adoption_installs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    adopt(directory.path())
        .await
        .expect("adopt the Runs schema");
    let database = open(&path).await;

    for table in owned_run_tables() {
        let row = database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
                [table.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<i64>("", "count").unwrap(),
            1,
            "the manifest names {table}, which adoption did not install"
        );
    }

    // The columns are part of the cutover contract: startup refuses an unknown
    // shape rather than letting a newer migration write through it.
    for (table, columns) in ADOPTED_TABLES
        .iter()
        .chain(RUN_OWNED_AUTHORED_TABLES.iter())
    {
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await
            .unwrap();
        let observed = rows
            .into_iter()
            .map(|row| row.try_get::<String>("", "name").unwrap())
            .collect::<std::collections::BTreeSet<_>>();
        let declared = columns
            .iter()
            .map(|column| (*column).to_owned())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(observed, declared, "manifest drift for {table}");
    }
    database.close().await.unwrap();
}

#[tokio::test]
async fn the_readiness_gate_opens_only_for_the_complete_published_result() {
    let directory = tempfile::tempdir().unwrap();
    let gate = RunsReadinessGate::watching(directory.path());

    assert!(!gate.is_ready(), "a missing record keeps the gate closed");

    publish_readiness(directory.path(), &Slice3Readiness::unavailable()).unwrap();
    assert!(!gate.is_ready());
    assert!(!published_readiness_is_complete(directory.path()));

    publish_readiness(directory.path(), &Slice3Readiness::complete()).unwrap();
    assert!(gate.is_ready());
    assert!(published_readiness_is_complete(directory.path()));
}

#[test]
fn a_partial_result_is_refused_rather_than_published() {
    let directory = tempfile::tempdir().unwrap();

    for close in [
        |readiness: &mut Slice3Readiness| readiness.runs_ownership = false,
        |readiness: &mut Slice3Readiness| readiness.effect_reconciliation = false,
        |readiness: &mut Slice3Readiness| readiness.graphql_status = false,
        |readiness: &mut Slice3Readiness| readiness.compatibility_executor = false,
    ] {
        let mut partial = Slice3Readiness::complete();
        close(&mut partial);
        assert!(publish_readiness(directory.path(), &partial).is_err());
        assert!(!published_readiness_is_complete(directory.path()));
    }

    // There is no Django writer to fall back to, and the published record says
    // so rather than leaving it implied.
    assert!(!Slice3Readiness::complete().django_write_fallback);
    assert!(!Slice3Readiness::unavailable().django_write_fallback);
}

#[tokio::test]
async fn adoption_refuses_an_unknown_runs_schema_before_the_lease_changes_hands() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    let database = open(&path).await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO django_migrations (app, name, applied) VALUES ('runs', ?, CURRENT_TIMESTAMP)",
            ["0099_a_migration_this_build_has_never_seen".into()],
        ))
        .await
        .unwrap();
    database.close().await.unwrap();

    let refusal = preflight(directory.path())
        .await
        .expect_err("an unknown Runs schema must be refused");

    assert_eq!(refusal.code_str(), "runs_schema_incompatible");
    // The refusal happens before any write, so the pre-cutover store is intact
    // and the operator's snapshot is still the recovery path.
    assert!(!directory.path().join("runs-adoption.json").exists());
    assert!(!directory.path().join("state.db.pre-rust-runs.1").exists());
}
