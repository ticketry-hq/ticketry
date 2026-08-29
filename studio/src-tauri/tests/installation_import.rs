//! PostgreSQL-to-SQLite acceptance against a disposable PostgreSQL database.
//!
//! Set `TICKETRY_TEST_POSTGRES_URL` to a database migrated by the current
//! Django backend. The test is inert when that explicit disposable source is
//! absent, so ordinary builds never contact a developer's database.

use muxed_studio_lib::installation::adoption::{self, AdoptionPath, AdoptionPlan, Phase, Readiness};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

#[tokio::test]
async fn imports_a_current_postgres_snapshot_and_switches_once() {
    let Ok(dsn) = std::env::var("TICKETRY_TEST_POSTGRES_URL") else {
        return;
    };
    let directory = tempfile::tempdir().expect("create isolated installation");
    std::fs::write(directory.path().join("database-url"), &dsn).expect("write source marker");
    std::fs::write(directory.path().join("database-url.enabled"), "enabled")
        .expect("enable disposable PostgreSQL source");

    let source_before = source_counts(&dsn).await;
    let interrupted = adoption::adopt_with(
        directory.path(),
        &AdoptionPlan::failing_after(Phase::BridgeWork),
    )
    .await
    .expect_err("interrupt after staging");
    assert_eq!(interrupted.phase(), Phase::BridgeWork, "{interrupted:?}");
    assert!(directory.path().join("database-url.enabled").exists());
    assert!(!directory.path().join("state.db").exists());
    assert!(std::fs::read_dir(directory.path())
        .unwrap()
        .flatten()
        .any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with(".postgres-import.")));
    assert_eq!(source_counts(&dsn).await, source_before);

    let postflight = adoption::adopt_with(
        directory.path(),
        &AdoptionPlan::failing_after(Phase::Postflight),
    )
    .await
    .expect_err("interrupt after staged postflight");
    assert_eq!(postflight.phase(), Phase::Postflight, "{postflight:?}");
    assert!(directory.path().join("database-url.enabled").exists());
    assert!(
        std::fs::read_dir(directory.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".postgres-import."))
            .count()
            >= 2
    );
    assert_eq!(source_counts(&dsn).await, source_before);

    let imported = adoption::adopt(directory.path())
        .await
        .expect("import current PostgreSQL");
    assert_eq!(imported.path, AdoptionPath::Imported);
    assert_eq!(imported.readiness, Readiness::Closed);
    assert!(directory.path().join("state.db").is_file());
    assert!(!directory.path().join("database-url.enabled").exists());
    assert!(directory
        .path()
        .join("database-url.postgresql-rollback")
        .is_file());
    assert_imported_reads(&directory.path().join("state.db")).await;

    let ready = adoption::open_readiness(directory.path(), imported)
        .await
        .expect("open imported readiness");
    assert_eq!(ready.readiness, Readiness::Open);

    let reopened = adoption::adopt(directory.path())
        .await
        .expect("reopen imported SQLite");
    assert_eq!(reopened.path, AdoptionPath::Reopened);
    assert!(reopened.previously_ready);
    assert_eq!(source_counts(&dsn).await, source_before);
}

#[tokio::test]
async fn imports_a_supported_historical_postgres_generation() {
    let Ok(dsn) = std::env::var("TICKETRY_TEST_HISTORICAL_POSTGRES_URL") else {
        return;
    };
    let directory = tempfile::tempdir().expect("create isolated installation");
    std::fs::write(directory.path().join("database-url"), &dsn).expect("write source marker");
    std::fs::write(directory.path().join("database-url.enabled"), "enabled")
        .expect("enable disposable historical source");

    let source_before = source_counts(&dsn).await;
    let imported = adoption::adopt(directory.path())
        .await
        .expect("import historical PostgreSQL");
    assert_eq!(imported.path, AdoptionPath::Imported);
    assert_eq!(imported.generation, "django-worktracker-0036_issue_module");
    assert_eq!(source_counts(&dsn).await, source_before);
    assert_eq!(source_before.1, 1);
    assert_eq!(imported.bridges.len(), 1);
    assert!(imported.bridges[0].starts_with("postgres-django-worktracker-0036"));
}

async fn source_counts(dsn: &str) -> (i64, i64) {
    let database = Database::connect(dsn)
        .await
        .expect("open disposable source");
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT \
             (SELECT COUNT(*) FROM django_migrations) AS migrations, \
             (SELECT COUNT(*) FROM worktracker_workspace) AS workspaces"
                .to_owned(),
        ))
        .await
        .expect("count source rows")
        .expect("count query returned a row");
    let counts = (
        row.try_get::<i64>("", "migrations").unwrap(),
        row.try_get::<i64>("", "workspaces").unwrap(),
    );
    database.close().await.expect("close disposable source");
    counts
}

async fn assert_imported_reads(database_path: &std::path::Path) {
    let database = Database::connect(format!("sqlite://{}?mode=ro", database_path.display()))
        .await
        .expect("open imported SQLite");
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT child.id, child.parent_id, child.rank, child.is_archived, \
             project.name AS project_name, binding.required_skills, \
             (SELECT COUNT(*) FROM worktracker_issue_blocked_by edge \
              WHERE edge.from_issue_id = child.id) AS blocker_count \
             FROM worktracker_issue child \
             JOIN worktracker_project project ON project.id = child.project_id \
             JOIN worktracker_launchbinding binding ON binding.issue_type_id = child.issue_type_id \
             WHERE child.sequence_id = 2"
                .to_owned(),
        ))
        .await
        .expect("read imported relationships")
        .expect("the populated child was imported");
    assert_eq!(
        row.try_get::<String>("", "id").unwrap(),
        "66666666666666666666666666666666"
    );
    assert_eq!(
        row.try_get::<String>("", "parent_id").unwrap(),
        "55555555555555555555555555555555"
    );
    assert_eq!(row.try_get::<String>("", "rank").unwrap(), "f");
    assert_eq!(row.try_get::<i64>("", "is_archived").unwrap(), 1);
    assert_eq!(
        row.try_get::<String>("", "project_name").unwrap(),
        "PostgreSQL → SQLite"
    );
    assert_eq!(
        row.try_get::<String>("", "required_skills").unwrap(),
        "[\"rust\",\"postgres\"]"
    );
    assert_eq!(row.try_get::<i64>("", "blocker_count").unwrap(), 1);
    database.close().await.expect("close imported SQLite");
}
