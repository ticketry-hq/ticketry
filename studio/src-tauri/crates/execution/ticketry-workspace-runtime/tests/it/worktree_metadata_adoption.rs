//! Adoption of the Django `worktrees` index by the Rust runtime.
//!
//! Every assertion here is about preservation: the same rows, the same derived
//! Git metadata, the same lifecycle state, proved by a stable digest across a
//! verified snapshot and a restart.

use std::path::Path;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_workspace_runtime::persistence::{
    adopt, preflight, worktrees_adopted, SourceClassification, WorktreePersistenceErrorCode,
    LEDGER_TABLE,
};

async fn fixture(path: &Path) {
    super::execution_legacy_fixture::provision_current(path.parent().unwrap()).await;
    let database = open(path).await;
    database.execute_unprepared("DELETE FROM worktrees; INSERT INTO worktrees (id,task_id,workspace_slug,project_id,module_id,ticket_seq,repo_root,path,branch,base_branch,base_commit,status,ephemeral,created_at,updated_at) VALUES ('000000000000000000000000000002c2','00000000000000000000000000089307','worktree-fixture','00000000000000000000000000089301','00000000000000000000000000089305',881,'/repos/ticketry','/worktrees/ticketry/CODIN-881-worktree-fixture','wt/CODIN-881-worktree-fixture','main','0123456789abcdef0123456789abcdef01234567','active',0,'2026-01-01T00:00:00+00:00','2026-01-01T00:00:00+00:00')").await.unwrap();
    database.close().await.unwrap();
}

async fn open(path: &Path) -> sea_orm::DatabaseConnection {
    Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap()
}

async fn scalar(database: &sea_orm::DatabaseConnection, query: &str) -> String {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .unwrap()
        .expect("query returns a row")
        .try_get::<String>("", "value")
        .unwrap()
}

#[tokio::test]
async fn preflight_classifies_django_metadata_without_writing() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;

    let source = preflight(directory.path()).await.unwrap();

    assert_eq!(source, SourceClassification::Django("0001_initial"));
    let database = open(&path).await;
    assert!(!worktrees_adopted(&database).await);
}

#[tokio::test]
async fn adopts_existing_rows_in_place_and_reopens_deterministically() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;

    let first = adopt(directory.path()).await.unwrap();
    let second = adopt(directory.path()).await.unwrap();

    assert_eq!(first.source, SourceClassification::Django("0001_initial"));
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(first.stable_digest, second.stable_digest);
    assert_eq!(first.row_count, 1);
    assert_eq!(second.row_count, 1);
    assert!(first.restoration_verified);

    let snapshot = first.snapshot_path.clone().unwrap();
    assert!(snapshot.is_file());
    assert!(directory.path().join("worktree-adoption.json").is_file());

    let database = open(&path).await;
    assert!(worktrees_adopted(&database).await);
    // The Git-owned metadata survived adoption byte for byte.
    assert_eq!(
        scalar(
            &database,
            "SELECT path AS value FROM worktrees WHERE ticket_seq=881",
        )
        .await,
        "/worktrees/ticketry/CODIN-881-worktree-fixture"
    );
    assert_eq!(
        scalar(
            &database,
            "SELECT branch || ' ' || base_branch || ' ' || base_commit || ' ' || status AS value FROM worktrees WHERE ticket_seq=881",
        )
        .await,
        "wt/CODIN-881-worktree-fixture main 0123456789abcdef0123456789abcdef01234567 active"
    );
    assert_eq!(
        scalar(
            &database,
            &format!("SELECT source_leaf AS value FROM {LEDGER_TABLE} WHERE singleton=1"),
        )
        .await,
        "0001_initial"
    );
    assert_eq!(
        scalar(
            &database,
            "SELECT CASE WHEN pull_request_url IS NULL THEN 'null' ELSE pull_request_url END AS value FROM worktrees WHERE ticket_seq=881",
        )
        .await,
        "null"
    );
}

#[tokio::test]
async fn refuses_an_unknown_worktree_schema() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("ALTER TABLE worktrees ADD COLUMN unexpected varchar NULL")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(
        error.code(),
        WorktreePersistenceErrorCode::IncompatibleSchema
    );
    let database = open(&path).await;
    assert!(!worktrees_adopted(&database).await);
}

#[tokio::test]
async fn refuses_semantically_invalid_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("UPDATE worktrees SET status='integrated'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(error.code(), WorktreePersistenceErrorCode::InvalidMetadata);
    let database = open(&path).await;
    assert!(!worktrees_adopted(&database).await);
}

#[tokio::test]
async fn refuses_a_worktree_row_without_its_work_item() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("UPDATE worktrees SET task_id='00000000000000000000000000000000'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(error.code(), WorktreePersistenceErrorCode::InvalidMetadata);
}

#[tokio::test]
async fn refuses_a_store_without_django_worktree_history() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("DELETE FROM django_migrations WHERE app='worktrees'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(
        error.code(),
        WorktreePersistenceErrorCode::IncompatibleSchema
    );
}
