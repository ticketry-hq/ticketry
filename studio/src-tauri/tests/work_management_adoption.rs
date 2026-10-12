mod common;

use std::path::Path;
use ticketry_work_management::{
    install_launch_binding_entry_skill_schema, install_workflow_handoff_schema,
};

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_edition::{has, EditionCapability};
use ticketry_work_management::{adopt, SourceClassification};

async fn django_fixture(database_path: &Path) {
    common::execution_legacy_fixture::provision_current(
        database_path
            .parent()
            .expect("the database has a data directory"),
    )
    .await;
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
    django_fixture(&path).await;
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
    django_fixture(&path).await;
    normalize_fixture_counters(&path).await;
    adopt(directory.path()).await.expect("adopt fixture");

    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open adopted WorkTracker");
    install_launch_binding_entry_skill_schema(&database)
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
async fn reopens_after_the_ledger_backed_workflow_handoff_migration() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path).await;
    normalize_fixture_counters(&path).await;
    adopt(directory.path()).await.expect("adopt fixture");

    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open adopted WorkTracker");
    install_workflow_handoff_schema(&database)
        .await
        .expect("install workflow-handoff final shape");
    database.close().await.expect("close migrated WorkTracker");

    let reopened = adopt(directory.path())
        .await
        .expect("reopen ledger-backed workflow-handoff shape");
    assert_eq!(reopened.source, SourceClassification::RustOwned);
    assert!(reopened.snapshot_path.is_none());
}

#[tokio::test]
async fn refuses_an_enabled_postgresql_installation_without_touching_sqlite() {
    let directory = tempfile::tempdir().expect("create fixture directory");
    let path = directory.path().join("state.db");
    django_fixture(&path).await;
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
    django_fixture(&path).await;
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

#[tokio::test]
async fn reopens_after_sprint_migration_with_all_planning_tables_owned() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path).await;
    normalize_fixture_counters(&path).await;
    adopt(directory.path())
        .await
        .expect("adopt the pre-sprint database");
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    ticketry_work_management::install_sprint_schema(&database)
        .await
        .unwrap();
    database.close().await.unwrap();
    let upgraded = adopt(directory.path())
        .await
        .expect("reopen sprint-owned database");
    assert_eq!(upgraded.source, SourceClassification::RustOwned);
    assert!(upgraded.restoration_verified);

    // Existing no-rank Sprint installations must reopen before their migration,
    // and the same adoption seam must accept the ledger-backed ranked shape.
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap();
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .unwrap();
    database.close().await.unwrap();
    let ranked = adopt(directory.path())
        .await
        .expect("reopen sprint-owned database after rank migration");
    assert_eq!(ranked.source, SourceClassification::RustOwned);
    assert!(ranked.restoration_verified);
}

/// Adopt the Django fixture, then give its Implementation type launch bindings
/// whose entry skill is unset, empty, or already chosen before migration 0047.
async fn adopted_bindings_before_entry_skill_adoption(
    directory: &Path,
) -> sea_orm::DatabaseConnection {
    let path = directory.join("state.db");
    django_fixture(&path).await;
    normalize_fixture_counters(&path).await;
    adopt(directory).await.expect("adopt fixture");
    let database = Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .expect("open adopted WorkTracker");
    let project = common::execution_legacy_fixture::PROJECT;
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_state
                (id,name,\"group\",color,created_at,updated_at,project_id,sort_order,is_protected)
             VALUES
                ('00000000000000000000000000089401','Grill','backlog','#60646C',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{project}',2,0),
                ('00000000000000000000000000089402','Spec','unstarted','#8E4EC6',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{project}',3,0),
                ('00000000000000000000000000089403','Tickets','unstarted','#33B1FF',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{project}',4,0);
             ALTER TABLE worktracker_launchbinding ADD COLUMN entry_skill varchar(128) NULL;
             INSERT INTO worktracker_launchbinding
                (prompt,created_at,updated_at,issue_type_id,state_id,auto_start,
                 subtree_run_enabled,required_skills,model_id,reasoning_id,entry_skill)
             VALUES
                ('unset',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'00000000000000000000000000089304',
                 '00000000000000000000000000089401',0,0,'[\"grill-with-docs\"]',NULL,NULL,NULL),
                ('empty',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'00000000000000000000000000089304',
                 '00000000000000000000000000089402',0,0,'[\"to-spec\"]',NULL,NULL,''),
                ('chosen',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'00000000000000000000000000089304',
                 '00000000000000000000000000089403',0,0,'[\"to-tickets\"]',NULL,NULL,'custom-skill');"
        ))
        .await
        .expect("seed launch bindings before entry-skill adoption");
    database
}

async fn entry_skills(database: &sea_orm::DatabaseConnection) -> Vec<(String, Option<String>)> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT prompt, entry_skill FROM worktracker_launchbinding ORDER BY prompt".to_owned(),
        ))
        .await
        .expect("read entry skills")
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "prompt").expect("binding prompt"),
                row.try_get("", "entry_skill").expect("entry skill"),
            )
        })
        .collect()
}

#[tokio::test]
async fn pocock_entry_skill_adoption_fills_only_unset_reviewed_stage_skills() {
    if !has(EditionCapability::ReviewedWorkflowDefaults) {
        return; // Core never fills entry skills; see the core counterpart.
    }
    let directory = tempfile::tempdir().expect("create fixture directory");
    let database = adopted_bindings_before_entry_skill_adoption(directory.path()).await;

    install_launch_binding_entry_skill_schema(&database)
        .await
        .expect("adopt reviewed entry skills");

    assert_eq!(
        entry_skills(&database).await,
        vec![
            ("chosen".to_owned(), Some("custom-skill".to_owned())),
            ("empty".to_owned(), Some(String::new())),
            ("unset".to_owned(), Some("grill-with-docs".to_owned())),
        ]
    );
}

/// CODING-2862: core records the entry-skill checkpoint without filling any
/// binding, so unset, empty and chosen entry skills all survive startup.
#[tokio::test]
async fn core_entry_skill_checkpoint_leaves_every_binding_unchanged() {
    if has(EditionCapability::ReviewedWorkflowDefaults) {
        return; // Pocock fills reviewed stage skills; see the Pocock test.
    }
    let directory = tempfile::tempdir().expect("create fixture directory");
    let database = adopted_bindings_before_entry_skill_adoption(directory.path()).await;
    let before = entry_skills(&database).await;

    install_launch_binding_entry_skill_schema(&database)
        .await
        .expect("record the entry-skill checkpoint");
    install_launch_binding_entry_skill_schema(&database)
        .await
        .expect("repeat the entry-skill checkpoint");

    assert_eq!(
        before,
        vec![
            ("chosen".to_owned(), Some("custom-skill".to_owned())),
            ("empty".to_owned(), Some(String::new())),
            ("unset".to_owned(), None),
        ]
    );
    assert_eq!(entry_skills(&database).await, before);
    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT migration_id FROM {} WHERE singleton = 1",
                ticketry_work_management::LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_LEDGER_TABLE
            ),
        ))
        .await
        .expect("read entry-skill ledger")
        .expect("entry-skill ledger row");
    assert_eq!(
        ledger
            .try_get::<String>("", "migration_id")
            .expect("migration id"),
        ticketry_work_management::LAUNCH_BINDING_ENTRY_SKILL_MIGRATION_MIGRATION_ID
    );
}
