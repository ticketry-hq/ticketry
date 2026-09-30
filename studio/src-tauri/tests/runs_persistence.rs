mod common;

use std::path::Path;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement, TransactionTrait};
use ticketry_runs::{adopt, LaunchIntent, RunsServices, SourceClassification};

async fn fixture(path: &Path) {
    let directory = path.parent().expect("the database has a data directory");
    common::execution_legacy_fixture::provision_runs_fixture(directory).await;
    common::execution_legacy_fixture::mutate(
        directory,
        r#"
INSERT INTO agent_runs
    (id,ticket_seq,agent,status,started_at,ended_at,exit_code,cwd,provider_session_id,lifecycle_state,lifecycle_updated_at,scope,issue_id)
VALUES
    ('run-stable',991,'codex','completed','2026-01-01T00:00:00+00:00','2026-01-01T01:00:00+00:00',0,NULL,'provider-stable','exited','2026-01-01T01:00:00+00:00','task','00000000000000000000000000000324');
INSERT INTO automation_attempts
    (id,transition_id,from_state_id,to_state_id,workflow_revision,status,agent,agent_run_id,error,created_at,updated_at,issue_id,error_details,retryable,retry_of_id,root_attempt_id,dismissed_at)
VALUES
    ('00000000000000000000000000000385','00000000000000000000000000000386','00000000000000000000000000000322','00000000000000000000000000000322',7,'failed','codex','run-stable','fixture','2026-01-01 00:00:00','2026-01-01 01:00:00','00000000000000000000000000000324',NULL,1,NULL,NULL,'2026-01-02 00:00:00');
"#,
    )
    .await;
}

async fn open(path: &Path) -> sea_orm::DatabaseConnection {
    Database::connect(format!("sqlite:{}?mode=rw", path.display()))
        .await
        .unwrap()
}

#[tokio::test]
async fn adopts_current_history_without_rewriting_and_reopens_deterministically() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let first = adopt(directory.path()).await.unwrap();
    assert!(matches!(first.source, SourceClassification::Django(_)));
    let second = adopt(directory.path()).await.unwrap();
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(first.stable_digest, second.stable_digest);
    let db = open(&path).await;
    let columns = db
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info('agent_runs')".to_owned(),
        ))
        .await
        .unwrap();
    let adopted = columns
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "name").unwrap(),
                row.try_get::<i32>("", "notnull").unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(adopted["agent"], 0);
    assert_eq!(adopted["launch_state"], 0);
    assert_eq!(adopted["launch_model"], 0);
    let services = RunsServices::new(db);
    let run = services
        .queries()
        .runs()
        .find("run-stable")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(run.provider_session_id.as_deref(), Some("provider-stable"));
    assert_eq!(run.started_at, "2026-01-01T00:00:00+00:00");
    assert_eq!(run.status, "completed");
    let attempt = services
        .queries()
        .attempts()
        .find("00000000000000000000000000000385")
        .await
        .unwrap()
        .unwrap();
    assert!(attempt.dismissed_at.is_some());
    assert_eq!(attempt.agent_run_id.as_deref(), Some("run-stable"));
}

#[tokio::test]
async fn adopts_live_launch_metadata_lineage_without_losing_agentless_runs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    let db = open(&path).await;
    db.execute_unprepared(
        "UPDATE agent_runs SET launch_model='legacy-model' WHERE id='run-stable';
         ALTER TABLE agent_runs DROP COLUMN model;
         ALTER TABLE agent_runs DROP COLUMN reasoning;
         ALTER TABLE agent_runs ADD COLUMN initial_prompt text NULL;
         INSERT INTO agent_runs
           (id, issue_id, agent, status, started_at, scope, launch_state, launch_model)
         SELECT 'shell-agentless', issue_id, NULL, 'completed', started_at, 'shell',
                launch_state, NULL FROM agent_runs WHERE id='run-stable';
         DELETE FROM django_migrations
          WHERE app='runs' AND name IN
            ('0013_agentrun_launch_configuration_snapshot', '0015_merge_20260819_1521');
         INSERT INTO django_migrations (app, name, applied)
         VALUES ('runs', '0015_agentrun_initial_prompt', CURRENT_TIMESTAMP);",
    )
    .await
    .unwrap();
    db.close().await.unwrap();

    let first = adopt(directory.path()).await.unwrap();
    assert!(matches!(first.source, SourceClassification::Django(_)));
    let second = adopt(directory.path()).await.unwrap();
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(first.stable_digest, second.stable_digest);

    let db = open(&path).await;
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT launch_state, launch_model FROM agent_runs WHERE id='run-stable'".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(row
        .try_get::<Option<String>>("", "launch_state")
        .unwrap()
        .is_none());
    assert_eq!(
        row.try_get::<String>("", "launch_model").unwrap(),
        "legacy-model"
    );
    let row = db
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM agent_runs WHERE id='shell-agentless' AND agent IS NULL"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "count").unwrap(), 1);
}

#[tokio::test]
async fn rejects_unknown_schema_before_mutation() {
    for mutation in [
        "ALTER TABLE agent_runs ADD COLUMN surprise text",
        "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"agent\" varchar NULL', '\"agent\" text NULL') WHERE type='table' AND name='agent_runs'; PRAGMA writable_schema=OFF",
        "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"launch_state\" varchar NULL', '\"launch_state\" varchar NOT NULL') WHERE type='table' AND name='agent_runs'; PRAGMA writable_schema=OFF",
        "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"launch_model\" varchar NULL', '\"launch_model\" varchar NULL DEFAULT ''legacy''') WHERE type='table' AND name='agent_runs'; PRAGMA writable_schema=OFF",
    ] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.db");
        fixture(&path).await;
        let db = open(&path).await;
        db.execute_unprepared(mutation).await.unwrap();
        db.close().await.unwrap();
        assert!(adopt(directory.path()).await.is_err(), "accepted {mutation}");
        let db = open(&path).await;
        let row = db
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE name='ticketry_runs_adoption'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "count").unwrap(), 0);
    }
}

#[tokio::test]
async fn rollback_hides_events_effects_and_watermarks_and_intent_rejects_unsafe_fields() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path).await;
    adopt(directory.path()).await.unwrap();
    let db = open(&path).await;
    let services = RunsServices::new(db.clone());
    let unsafe_intent = serde_json::json!({"effectId":"e","agentRunId":"run-stable","requestId":"r","projectId":"p","issueId":"i","scope":"task","provider":"codex","targetKind":"task","targetId":"i","command":"rm"});
    assert!(LaunchIntent::from_json(&unsafe_intent).is_err());
    let tx = db.begin().await.unwrap();
    services
        .outbox()
        .watermarks()
        .advance(&tx, "p", 42)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(services.outbox().watermarks().get("p").await.unwrap(), 0);
    assert_eq!(services.outbox().events().high_water().await.unwrap(), 0);
}
