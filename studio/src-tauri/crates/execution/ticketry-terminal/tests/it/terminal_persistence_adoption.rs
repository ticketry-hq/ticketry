use std::path::Path;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

#[tokio::test]
async fn fresh_database_without_terminal_history_installs_rust_schema_idempotently() {
    let directory = tempfile::tempdir().expect("create fresh Terminal fixture");
    provision_without_terminal_history(directory.path()).await;
    ticketry_runs::adopt(directory.path()).await.unwrap();

    assert_eq!(
        ticketry_terminal::preflight_terminal_persistence(directory.path())
            .await
            .unwrap(),
        ticketry_terminal::TerminalSourceClassification::Django("0000_no_terminal_history"),
    );
    let first = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let second = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();

    assert_eq!(first.tables["agent_terminal_sessions"].row_count, 0);
    assert_eq!(first.tables["terminal_launch_requests"].row_count, 0);
    assert_eq!(first.tables, second.tables);
    assert!(second.snapshot_path.is_none());
}

#[tokio::test]
async fn adoption_preserves_history_expires_leases_and_is_idempotent() {
    let directory = tempfile::tempdir().expect("create Terminal adoption fixture");
    provision_current(directory.path()).await;
    ticketry_runs::preflight(directory.path()).await.unwrap();
    ticketry_runs::adopt(directory.path()).await.unwrap();

    let first = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    assert_eq!(first.stale_viewer_leases_expired, 2);
    assert_eq!(first.tables["agent_terminal_sessions"].row_count, 2);
    assert_eq!(first.tables["terminal_launch_requests"].row_count, 1);
    assert_eq!(first.tables["terminal_launch_material"].row_count, 0);
    assert_eq!(first.tables["terminal_cleanup_effects"].row_count, 0);

    let second = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let third = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    assert_eq!(second.tables, third.tables);
    assert!(second.snapshot_path.is_none() && third.snapshot_path.is_none());

    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT agent_run_id, tmux_session_name, runtime_cleanup_pending, terminated_at FROM agent_terminal_sessions ORDER BY agent_run_id".to_owned(),
        ))
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].try_get::<String>("", "tmux_session_name").unwrap(),
        "run-active"
    );
    assert_eq!(
        rows[1].try_get::<String>("", "tmux_session_name").unwrap(),
        "pt-run-ended"
    );
    assert!(rows[0]
        .try_get::<bool>("", "runtime_cleanup_pending")
        .unwrap());
    let leases = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT agent_run_id, transport, generation, expires_at <= CURRENT_TIMESTAMP AS expired FROM agent_run_viewer_leases ORDER BY agent_run_id".to_owned(),
        ))
        .await
        .unwrap();
    assert_eq!(leases.len(), 2);
    assert_eq!(
        leases[0].try_get::<String>("", "transport").unwrap(),
        "native"
    );
    assert_eq!(
        leases[1].try_get::<String>("", "transport").unwrap(),
        "xterm"
    );
    for lease in leases {
        assert!(lease
            .try_get::<String>("", "generation")
            .unwrap()
            .starts_with("imported-"));
        assert_eq!(lease.try_get::<i32>("", "expired").unwrap(), 1);
    }
}

#[tokio::test]
async fn live_index_rename_lineage_adopts_without_inventing_legacy_launch_requests() {
    let directory = tempfile::tempdir().expect("create live-lineage fixture");
    provision_current(directory.path()).await;
    mutate(
        directory.path(),
        "DROP TABLE terminal_launch_requests; \
         DROP INDEX idx_agent_terminal_sessions_task_created; \
         CREATE INDEX idx_terminal_task_created ON agent_terminal_sessions(task_id, terminated_at, created_at DESC); \
         DELETE FROM django_migrations WHERE app='terminals' AND name IN \
           ('0005_terminallaunchrequest','0008_merge_20260819_1521','0009_alter_terminallaunchrequest_agent'); \
         INSERT INTO django_migrations(app,name,applied) VALUES \
           ('terminals','0008_rename_terminal_task_index',CURRENT_TIMESTAMP);",
    ).await;

    assert_eq!(
        ticketry_terminal::preflight_terminal_persistence(directory.path())
            .await
            .unwrap(),
        ticketry_terminal::TerminalSourceClassification::Django("0008_rename_terminal_task_index"),
    );
    let first = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    let second = ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    assert_eq!(first.tables["agent_terminal_sessions"].row_count, 2);
    assert_eq!(first.tables["terminal_launch_requests"].row_count, 0);
    assert_eq!(first.tables, second.tables);
}

#[tokio::test]
async fn adopted_store_gains_new_launch_material_columns_without_reownership() {
    let directory = tempfile::tempdir().expect("create launch-material upgrade fixture");
    provision_current(directory.path()).await;
    ticketry_runs::preflight(directory.path()).await.unwrap();
    ticketry_runs::adopt(directory.path()).await.unwrap();
    ticketry_terminal::adopt_terminal_persistence(directory.path())
        .await
        .unwrap();
    mutate(
        directory.path(),
        "ALTER TABLE terminal_launch_material DROP COLUMN profile;",
    )
    .await;

    ticketry_terminal::ensure_terminal_persistence_adopted(directory.path())
        .await
        .unwrap();

    let database = Database::connect(format!(
        "sqlite:{}?mode=ro",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    let columns = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info('terminal_launch_material')".to_owned(),
        ))
        .await
        .unwrap();
    assert!(columns
        .iter()
        .any(|row| row.try_get::<String>("", "name").unwrap() == "profile"));
}

#[tokio::test]
async fn preflight_refuses_schema_and_semantic_drift_before_mutation() {
    for (label, mutation) in [
        ("column", "ALTER TABLE agent_terminal_sessions ADD COLUMN surprise text"),
        ("type", "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"output_sequence\" bigint', '\"output_sequence\" text') WHERE type='table' AND name='agent_terminal_sessions'; PRAGMA writable_schema=OFF"),
        ("nullability", "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"agent\" varchar NULL', '\"agent\" varchar NOT NULL') WHERE type='table' AND name='agent_terminal_sessions'; PRAGMA writable_schema=OFF"),
        ("default", "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=replace(sql, '\"last_output_at\" varchar NULL', '\"last_output_at\" varchar NULL DEFAULT ''legacy''') WHERE type='table' AND name='agent_terminal_sessions'; PRAGMA writable_schema=OFF"),
        ("index", "CREATE INDEX surprise_terminal_index ON agent_terminal_sessions(agent)") ,
        ("constraint", "PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql=substr(sql,1,length(sql)-1) || ', CHECK (agent_run_id <> ''forbidden''))' WHERE type='table' AND name='agent_terminal_sessions'; PRAGMA writable_schema=OFF"),
        ("duplicate", "CREATE TABLE terminal_launch_requests_drift (effect_id varchar(64) NOT NULL PRIMARY KEY, agent_run_id varchar(255) NOT NULL, issue_id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, module_id varchar(64) NOT NULL, task_id varchar(64) NOT NULL, scope varchar(32) NOT NULL, doc_rel_path varchar NULL, command text NOT NULL, working_directory varchar NOT NULL, environment text NOT NULL CHECK (json_valid(environment) OR environment IS NULL), columns integer unsigned NOT NULL CHECK (columns >= 0), rows integer unsigned NOT NULL CHECK (rows >= 0), created_at varchar NOT NULL, agent varchar(64) NULL); INSERT INTO terminal_launch_requests_drift SELECT * FROM terminal_launch_requests; INSERT INTO terminal_launch_requests_drift SELECT 'legacy-effect-duplicate', agent_run_id, issue_id, project_id, module_id, task_id, scope, doc_rel_path, command, working_directory, environment, columns, rows, created_at, agent FROM terminal_launch_requests; DROP TABLE terminal_launch_requests; ALTER TABLE terminal_launch_requests_drift RENAME TO terminal_launch_requests"),
        ("scope", "UPDATE agent_terminal_sessions SET scope='unknown'"),
        ("json", "PRAGMA ignore_check_constraints=ON; UPDATE terminal_launch_requests SET environment='not-json'"),
        ("reference", "PRAGMA foreign_keys=OFF; UPDATE agent_terminal_sessions SET agent_run_id='missing-run' WHERE agent_run_id='run-active'"),
    ] {
        let directory = tempfile::tempdir().expect("create rejected Terminal fixture");
        provision_current(directory.path()).await;
        mutate(directory.path(), mutation).await;
        let error = ticketry_terminal::preflight_terminal_persistence(directory.path())
            .await
            .expect_err(label);
        assert!(matches!(
            error.code(),
            ticketry_terminal::TerminalPersistenceErrorCode::IncompatibleSchema
                | ticketry_terminal::TerminalPersistenceErrorCode::InvalidMetadata
        ));
        assert!(!directory.path().join("terminal-adoption.json").exists());
    }
}

async fn provision_current(directory: &Path) {
    super::execution_legacy_fixture::provision_current(directory).await;
    mutate(directory, "INSERT INTO agent_runs (id,ticket_seq,status,started_at,ended_at,cwd,scope,issue_id,agent) VALUES ('run-active',865,'running','2026-08-19T12:00:00Z',NULL,'/tmp','task','00000000000000000000000000089307','codex'),('run-ended',865,'completed','2026-08-19T12:00:00Z','2026-08-19T13:00:00Z','/tmp','task','00000000000000000000000000089307','codex'); INSERT INTO agent_terminal_sessions (agent_run_id,tmux_session_name,task_id,module_id,project_id,created_at,terminated_at,scope,runtime_cleanup_pending,runtime_namespace,output_sequence,last_output_at,agent) VALUES ('run-active','run-active','00000000000000000000000000089307','00000000000000000000000000089305','00000000000000000000000000089301','2026-08-19T12:00:00Z',NULL,'task',1,'ticketry',0,'2026-08-19T12:00:00Z','codex'),('run-ended','pt-run-ended','00000000000000000000000000089307','00000000000000000000000000089305','00000000000000000000000000089301','2026-08-19T12:00:00Z','2026-08-19T13:00:00Z','task',0,'ticketry',0,'2026-08-19T12:00:00Z','codex'); INSERT INTO agent_run_viewer_leases (agent_run_id,viewer_id,transport,acquired_at,expires_at) VALUES ('run-active','viewer-1','desktop',CURRENT_TIMESTAMP,datetime('now','+1 hour')),('run-ended','viewer-2','browser',CURRENT_TIMESTAMP,datetime('now','+1 hour')); INSERT INTO terminal_launch_requests (effect_id,agent_run_id,issue_id,project_id,module_id,task_id,agent,scope,command,working_directory,environment,columns,rows,created_at) VALUES ('legacy-effect','run-active','00000000000000000000000000089307','00000000000000000000000000089301','00000000000000000000000000089305','00000000000000000000000000089307','codex','task','legacy command','/tmp','{\"LEGACY\":\"1\"}',80,24,'2026-08-19T12:00:00Z')").await;
}

async fn provision_without_terminal_history(directory: &Path) {
    super::execution_legacy_fixture::provision_current(directory).await;
    mutate(directory, "DROP TABLE terminal_launch_requests; DROP TABLE agent_run_viewer_leases; DROP TABLE agent_terminal_sessions; DELETE FROM django_migrations WHERE app='terminals'").await;
}

async fn mutate(directory: &Path, sql: &str) {
    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        directory.join("state.db").display()
    ))
    .await
    .unwrap();
    database.execute_unprepared(sql).await.unwrap();
    database.close().await.unwrap();
}
