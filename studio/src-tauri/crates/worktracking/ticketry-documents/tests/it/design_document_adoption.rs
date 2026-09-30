//! Adoption of the Django `design_documents` registry by the Rust runtime.
//!
//! Every assertion here is about preservation: the same rows, the same ids,
//! roots, relative paths, scope, provenance, and timestamps, proved by a stable
//! digest across a verified snapshot and a restart. An installation whose
//! schema this runtime does not recognise must be left untouched.

use std::path::Path;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_documents::{
    adopt, documents_adopted, preflight, DocumentsPersistenceErrorCode, SourceClassification,
    LEDGER_TABLE,
};

async fn fixture(path: &Path) {
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    database
        .execute_unprepared(include_str!(
            "../../../../execution/ticketry-installation/src/adoption/provisioning.v1.sql"
        ))
        .await
        .unwrap();
    database
        .execute_unprepared(include_str!(
            "../../../../execution/ticketry-installation/src/adoption/provisioning-ledger.v1.sql"
        ))
        .await
        .unwrap();
    database.execute_unprepared("INSERT INTO design_documents (id,module_id,task_id,scope,root_dir,rel_path,discovered_by_run_id,created_at,updated_at) VALUES ('00000000000000000000000000000258','00000000000000000000000000000259','0000000000000000000000000000025a','task','/modules/ticketry/spec/rusting--cf2de16d/T755--adopt-design-document-metadata-with-safe','SPEC.md','run-documents-fixture','2026-01-01T00:00:00+00:00','2026-01-02T00:00:00+00:00'),('0000000000000000000000000000025b','00000000000000000000000000000259','00000000-0000-0000-0000-000000000000','plan','/modules/ticketry/spec/planning--3f2a','nested/Design.HTML',NULL,'2026-01-03T00:00:00+00:00','2026-01-03T00:00:00+00:00')").await.unwrap();
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
async fn preflight_classifies_django_documents_without_writing() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;

    let source = preflight(directory.path()).await.unwrap();

    assert_eq!(source, SourceClassification::Django("0001_initial"));
    let database = open(&path).await;
    assert!(!documents_adopted(&database).await);
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
    assert_eq!(first.row_count, 2);
    assert_eq!(second.row_count, 2);
    assert!(first.restoration_verified);
    assert!(first.snapshot_path.clone().unwrap().is_file());
    assert!(directory.path().join("documents-adoption.json").is_file());

    let database = open(&path).await;
    assert!(documents_adopted(&database).await);
    // Identity, authorized root, relative path, provenance, and timestamps all
    // survived adoption byte for byte.
    assert_eq!(
        scalar(
            &database,
            "SELECT id || ' ' || root_dir || ' ' || rel_path || ' ' || discovered_by_run_id || ' ' || created_at || ' ' || updated_at AS value \
             FROM design_documents WHERE scope='task'",
        )
        .await,
        "00000000000000000000000000000258 \
         /modules/ticketry/spec/rusting--cf2de16d/T755--adopt-design-document-metadata-with-safe \
         SPEC.md run-documents-fixture 2026-01-01T00:00:00+00:00 2026-01-02T00:00:00+00:00"
    );
    // A scratch row keeps the sentinel task identity and its null provenance.
    assert_eq!(
        scalar(
            &database,
            "SELECT task_id || ' ' || rel_path || ' ' || (discovered_by_run_id IS NULL) AS value \
             FROM design_documents WHERE scope='plan'",
        )
        .await,
        "00000000-0000-0000-0000-000000000000 nested/Design.HTML 1"
    );
    // The digest column arrives empty; nothing is invented from a file body.
    assert_eq!(
        scalar(
            &database,
            "SELECT COUNT(*) || '' AS value FROM design_documents WHERE content_digest IS NOT NULL",
        )
        .await,
        "0"
    );
    assert_eq!(
        scalar(
            &database,
            &format!("SELECT source_leaf AS value FROM {LEDGER_TABLE} WHERE singleton=1"),
        )
        .await,
        "0001_initial"
    );
}

#[tokio::test]
async fn refuses_an_unknown_document_schema() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("ALTER TABLE design_documents ADD COLUMN unexpected varchar NULL")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(
        error.code(),
        DocumentsPersistenceErrorCode::IncompatibleSchema
    );
    let database = open(&path).await;
    assert!(!documents_adopted(&database).await);
}

#[tokio::test]
async fn refuses_a_registry_whose_scope_is_not_a_known_document_scope() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("UPDATE design_documents SET scope='review'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(error.code(), DocumentsPersistenceErrorCode::InvalidRegistry);
    let database = open(&path).await;
    assert!(!documents_adopted(&database).await);
}

#[tokio::test]
async fn refuses_a_registry_that_escapes_its_authorized_root() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared(
            "UPDATE design_documents SET rel_path='../outside/SPEC.md' WHERE scope='task'",
        )
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(error.code(), DocumentsPersistenceErrorCode::InvalidRegistry);
}

#[tokio::test]
async fn refuses_a_relative_authorized_root() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared(
            "UPDATE design_documents SET root_dir='spec/relative' WHERE scope='plan'",
        )
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(error.code(), DocumentsPersistenceErrorCode::InvalidRegistry);
}

#[tokio::test]
async fn refuses_a_store_without_django_document_history() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let database = open(&path).await;
    database
        .execute_unprepared("DELETE FROM django_migrations WHERE app='documents'")
        .await
        .unwrap();
    database.close().await.unwrap();

    let error = adopt(directory.path()).await.unwrap_err();

    assert_eq!(
        error.code(),
        DocumentsPersistenceErrorCode::IncompatibleSchema
    );
    let database = open(&path).await;
    assert!(!documents_adopted(&database).await);
}
