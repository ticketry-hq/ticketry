use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::work_management::adoption::{adopt, SourceClassification};
use muxed_studio_lib::work_management::launch_binding_entry_skill_migration;
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

fn django_fixture(database_path: &Path) {
    let root = repository_root();
    let output = Command::new(root.join("backend/.venv/bin/python"))
        .arg(root.join("backend/worktracker/tests/build_shape_parity_fixture.py"))
        .arg(database_path)
        .current_dir(&root)
        .output()
        .expect("run Django fixture builder");
    assert!(
        output.status.success(),
        "Django fixture builder failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn normalize_fixture_counters(path: &Path) {
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open fixture counters");
    database.execute_unprepared(
        "UPDATE worktracker_project SET seq_counter = COALESCE((SELECT MAX(sequence_id) FROM worktracker_issue WHERE project_id = worktracker_project.id), 0)",
    ).await.expect("normalize fixture counters");
    database.close().await.expect("close fixture counters");
}

#[tokio::test]
async fn adopts_current_django_data_with_verified_recovery_evidence_and_reopens() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path);
    normalize_fixture_counters(&path).await;
    std::fs::write(
        directory.path().join("database-url"),
        "postgresql:///dormant",
    )
    .expect("write dormant PostgreSQL configuration");

    let first = adopt(directory.path()).await.expect("adopt fixture");
    assert_eq!(first.source, SourceClassification::DjangoCurrent);
    assert!(first.restoration_verified);
    assert!(first
        .snapshot_path
        .as_ref()
        .is_some_and(|path| path.is_file()));
    assert_eq!(first.snapshot_sha256.as_deref().map(str::len), Some(64));
    assert!(directory.path().join("worktracker-cutover.json").is_file());

    let second = adopt(directory.path())
        .await
        .expect("reopen adopted fixture");
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(second.stable_digest, first.stable_digest);
}

#[tokio::test]
async fn reopens_after_the_ledger_backed_entry_skill_migration() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path);
    normalize_fixture_counters(&path).await;
    adopt(directory.path()).await.expect("adopt fixture");

    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open adopted WorkTracker");
    launch_binding_entry_skill_migration::install(&database)
        .await
        .expect("install entry-skill final shape");
    database.close().await.expect("close migrated WorkTracker");

    let reopened = adopt(directory.path())
        .await
        .expect("reopen ledger-backed entry-skill shape");
    assert_eq!(reopened.source, SourceClassification::RustOwned);
    assert!(reopened.snapshot_path.is_none());
}

#[tokio::test]
async fn refuses_an_enabled_postgresql_installation_without_touching_sqlite() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path);
    normalize_fixture_counters(&path).await;
    std::fs::write(
        directory.path().join("database-url"),
        "postgresql:///ticketry",
    )
    .expect("write PostgreSQL configuration");
    std::fs::write(directory.path().join("database-url.enabled"), "enabled\n")
        .expect("enable PostgreSQL configuration");

    let error = adopt(directory.path())
        .await
        .expect_err("refuse PostgreSQL adoption");
    assert!(error.to_string().contains("only from SQLite"));

    let check = Database::connect(format!("sqlite:{}?mode=ro", path.display()))
        .await
        .expect("reopen untouched fixture");
    let ledger = check
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name='ticketry_worktracker_adoption'"
                .to_owned(),
        ))
        .await
        .expect("inspect ledger")
        .expect("count row")
        .try_get::<i64>("", "count")
        .expect("decode count");
    assert_eq!(ledger, 0);
}

#[tokio::test]
async fn refuses_unknown_owned_schema_before_installing_the_ledger() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path);
    normalize_fixture_counters(&path).await;
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open fixture");
    database
        .execute_unprepared("ALTER TABLE worktracker_issue ADD COLUMN unknown_writer bytea")
        .await
        .expect("inject unknown schema");
    database.close().await.expect("close fixture");

    let error = adopt(directory.path())
        .await
        .expect_err("reject unknown schema");
    assert!(error
        .to_string()
        .contains("unknown schema for worktracker_issue"));

    let check = Database::connect(format!("sqlite:{}?mode=ro", path.display()))
        .await
        .expect("reopen fixture");
    let ledger = check
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name='ticketry_worktracker_adoption'"
                .to_owned(),
        ))
        .await
        .expect("inspect ledger")
        .expect("count row")
        .try_get::<i64>("", "count")
        .expect("decode count");
    assert_eq!(ledger, 0);
}
