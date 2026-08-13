use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::runs_persistence::{adopt, LaunchIntent, RunsServices, SourceClassification};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement, TransactionTrait};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn fixture(path: &Path) {
    let script = r#"
import os, sys, uuid
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
from apps.runs.models import AgentRun, AutomationAttempt
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id=uuid.UUID(int=800),slug='runs-fixture',name='Runs Fixture'); pjt=Project.objects.create(id=uuid.UUID(int=801),workspace=w,name='Runs',slug='RUN'); s=State.objects.create(id=uuid.UUID(int=802),project=pjt,name='Todo',group='unstarted',sort_order=1); t=IssueType.objects.create(id=uuid.UUID(int=803),project=pjt,name='Story',level='task',sort_order=1,start_state=s)
i=Issue.objects.create(id=uuid.UUID(int=804),project=pjt,type='task',issue_type=t,state=s,name='Runs fixture',sequence_id=991,rank='z')
AgentRun.objects.create(id='run-stable',issue=i,ticket_seq=991,agent='codex',status='completed',started_at='2026-01-01T00:00:00+00:00',ended_at='2026-01-01T01:00:00+00:00',exit_code=0,provider_session_id='provider-stable',lifecycle_state='exited',lifecycle_updated_at='2026-01-01T01:00:00+00:00',scope='task')
a=AutomationAttempt.objects.create(id=uuid.UUID(int=901),transition_id=uuid.UUID(int=902),issue=i,from_state_id=s.id,to_state_id=s.id,workflow_revision=7,status='failed',agent='codex',agent_run_id='run-stable',error='fixture',retryable=True)
AutomationAttempt.objects.filter(id=a.id).update(created_at='2026-01-01 00:00:00',updated_at='2026-01-01 01:00:00',dismissed_at='2026-01-02 00:00:00')
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
async fn adopts_current_history_without_rewriting_and_reopens_deterministically() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    let first = adopt(directory.path()).await.unwrap();
    assert!(matches!(first.source, SourceClassification::Django(_)));
    let second = adopt(directory.path()).await.unwrap();
    assert_eq!(second.source, SourceClassification::RustOwned);
    assert_eq!(first.stable_digest, second.stable_digest);
    let db = open(&path).await;
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
async fn rejects_unknown_schema_before_mutation() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
    let db = open(&path).await;
    db.execute_unprepared("ALTER TABLE agent_runs ADD COLUMN surprise text")
        .await
        .unwrap();
    db.close().await.unwrap();
    assert!(adopt(directory.path())
        .await
        .unwrap_err()
        .to_string()
        .contains("unknown schema"));
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

#[tokio::test]
async fn rollback_hides_events_effects_and_watermarks_and_intent_rejects_unsafe_fields() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);
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
