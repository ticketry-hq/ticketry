use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

const LEAVES: &[&str] = &[
    "0001_initial",
    "0002_agent_run_viewer_lease",
    "0003_agentterminalsession_runtime_cleanup_pending",
    "0004_agentterminalsession_runtime_namespace",
    "0005_terminal_output_activity",
    "0005_terminallaunchrequest",
    "0006_terminal_session_optional_agent",
    "0007_restore_agent_run_fk_cascade",
    "0008_merge_20260819_1521",
    "0009_alter_terminallaunchrequest_agent",
];

#[tokio::test]
async fn fresh_database_without_terminal_history_installs_rust_schema_idempotently() {
    let directory = tempfile::tempdir().expect("create fresh Terminal fixture");
    provision_without_terminal_history(directory.path());
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
async fn every_supported_django_leaf_has_an_exact_classifier() {
    for leaf in LEAVES {
        let directory = tempfile::tempdir().expect("create Terminal leaf fixture");
        migrate(directory.path(), leaf);
        assert_eq!(
            ticketry_terminal::preflight_terminal_persistence(directory.path())
                .await
                .unwrap_or_else(|error| panic!("{leaf} must classify: {error}")),
            ticketry_terminal::TerminalSourceClassification::Django(leaf),
        );
    }
}

#[tokio::test]
async fn adoption_preserves_history_expires_leases_and_is_idempotent() {
    let directory = tempfile::tempdir().expect("create Terminal adoption fixture");
    provision_current(directory.path());
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
    provision_current(directory.path());
    mutate(
        directory.path(),
        "DROP TABLE terminal_launch_requests; \
         DROP INDEX idx_agent_terminal_sessions_task_created; \
         CREATE INDEX idx_terminal_task_created ON agent_terminal_sessions(task_id, terminated_at, created_at DESC); \
         DELETE FROM django_migrations WHERE app='terminals' AND name IN \
           ('0005_terminallaunchrequest','0008_merge_20260819_1521','0009_alter_terminallaunchrequest_agent'); \
         INSERT INTO django_migrations(app,name,applied) VALUES \
           ('terminals','0008_rename_terminal_task_index',CURRENT_TIMESTAMP);",
    );

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
        provision_current(directory.path());
        mutate(directory.path(), mutation);
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

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../..")
        .canonicalize()
        .unwrap()
}

fn migrate(directory: &Path, leaf: &str) {
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .arg(repository_root().join("backend/manage.py"))
        .args(["migrate", "terminals", leaf, "--noinput"])
        .env("MUXED_STATE_DB", directory.join("state.db"))
        .env("MUXED_DATA_DIR", directory)
        .env("MUXED_FORCE_SQLITE", "true")
        .env(
            "DJANGO_SETTINGS_MODULE",
            "studio_server.tests.terminal_migration_settings",
        )
        .current_dir(repository_root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn provision_current(directory: &Path) {
    let script = r#"
import os, sys
from pathlib import Path
db=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(db); os.environ['MUXED_DATA_DIR']=str(db.parent); os.environ['MUXED_FORCE_SQLITE']='true'
from studio_server import settings
settings.INSTALLED_APPS = [*settings.INSTALLED_APPS, 'apps.terminals']
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession, AgentRunViewerLease, TerminalLaunchRequest
from django.utils import timezone
from datetime import timedelta
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id='00000000000000000000000000086500',slug='terminal-adoption',name='Terminal Adoption')
p=Project.objects.create(id='00000000000000000000000000086501',workspace=w,name='Terminal Adoption',slug='T865',seq_counter=865)
s=State.objects.create(id='00000000000000000000000000086502',project=p,name='Todo',group='unstarted',sort_order=1)
t=IssueType.objects.create(id='00000000000000000000000000086503',project=p,name='Implementation',level='task',sort_order=1,start_state=s)
i=Issue.objects.create(id='00000000000000000000000000086504',project=p,type='task',issue_type=t,state=s,name='Adopt',sequence_id=865,rank='a')
for n, ended in [('run-active',None),('run-ended','2026-08-19T13:00:00Z')]:
 r=AgentRun.objects.create(id=n,issue=i,agent='codex',status='running' if ended is None else 'completed',started_at='2026-08-19T12:00:00Z',ended_at=ended,cwd=str(db.parent),scope='task')
 AgentTerminalSession.objects.create(agent_run=r,tmux_session_name=n if n=='run-active' else 'pt-'+n,task_id=str(i.id),module_id=str(i.id),project_id=str(p.id),agent='codex',created_at='2026-08-19T12:00:00Z',terminated_at=ended,runtime_namespace='ticketry',runtime_cleanup_pending=(n=='run-active'),scope='task',last_output_at='2026-08-19T12:00:00Z')
active=AgentRun.objects.get(id='run-active')
AgentRunViewerLease.objects.create(agent_run=active,viewer_id='viewer-1',transport='desktop',acquired_at=timezone.now(),expires_at=timezone.now()+timedelta(hours=1))
ended=AgentRun.objects.get(id='run-ended')
AgentRunViewerLease.objects.create(agent_run=ended,viewer_id='viewer-2',transport='browser',acquired_at=timezone.now(),expires_at=timezone.now()+timedelta(hours=1))
TerminalLaunchRequest.objects.create(effect_id='legacy-effect',agent_run_id='run-active',issue_id=str(i.id),project_id=str(p.id),module_id=str(i.id),task_id=str(i.id),agent='codex',scope='task',command='legacy command',working_directory=str(db.parent),environment={'LEGACY':'1'},columns=80,rows=24,created_at='2026-08-19T12:00:00Z')
from django.db import connection
with connection.cursor() as c:
 c.execute('ALTER TABLE agent_runs DROP COLUMN launch_state'); c.execute('ALTER TABLE agent_runs DROP COLUMN launch_model')
 c.execute("DELETE FROM django_migrations WHERE app='runs' AND name IN ('0013_agentrun_optional_agent','0014_agentrun_launch_metadata','0015_merge_20260819_1521')")
"#;
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .args(["-c", script])
        .arg(directory.join("state.db"))
        .current_dir(repository_root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn provision_without_terminal_history(directory: &Path) {
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .arg(repository_root().join("backend/manage.py"))
        .args(["migrate", "--noinput"])
        .env("MUXED_STATE_DB", directory.join("state.db"))
        .env("MUXED_DATA_DIR", directory)
        .env("MUXED_FORCE_SQLITE", "true")
        .current_dir(repository_root())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn mutate(directory: &Path, sql: &str) {
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .args(["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()"])
        .arg(directory.join("state.db"))
        .arg(sql)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
