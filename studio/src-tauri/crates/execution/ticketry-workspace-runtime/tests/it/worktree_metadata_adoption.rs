//! Adoption of the Django `worktrees` index by the Rust runtime.
//!
//! Every assertion here is about preservation: the same rows, the same derived
//! Git metadata, the same lifecycle state, proved by a stable digest across a
//! verified snapshot and a restart.

use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_workspace_runtime::persistence::{
    adopt, preflight, worktrees_adopted, SourceClassification, WorktreePersistenceErrorCode,
    LEDGER_TABLE,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../..")
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
from apps.worktrees.models import Worktree
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id=uuid.UUID(int=700),slug='worktree-fixture',name='Worktree Fixture'); pjt=Project.objects.create(id=uuid.UUID(int=701),workspace=w,name='Worktrees',slug='WTR'); s=State.objects.create(id=uuid.UUID(int=702),project=pjt,name='Todo',group='unstarted',sort_order=1); t=IssueType.objects.create(id=uuid.UUID(int=703),project=pjt,name='Story',level='task',sort_order=1,start_state=s)
m=Issue.objects.create(id=uuid.UUID(int=704),project=pjt,type='module',issue_type=t,state=s,name='Module',sequence_id=880,rank='y')
i=Issue.objects.create(id=uuid.UUID(int=705),project=pjt,type='task',issue_type=t,state=s,module=m,name='Worktree fixture',sequence_id=881,rank='z')
Worktree.objects.create(id=uuid.UUID(int=706).hex,task_id=uuid.UUID(int=705).hex,workspace_slug='worktree-fixture',project_id=uuid.UUID(int=701).hex,module_id=uuid.UUID(int=704).hex,ticket_seq=881,repo_root='/repos/ticketry',path='/worktrees/ticketry/CODIN-881-worktree-fixture',branch='wt/CODIN-881-worktree-fixture',base_branch='main',base_commit='0123456789abcdef0123456789abcdef01234567',status='active',ephemeral=False,created_at='2026-01-01T00:00:00+00:00',updated_at='2026-01-01T00:00:00+00:00')
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
    fixture(&path);

    let source = preflight(directory.path()).await.unwrap();

    assert_eq!(source, SourceClassification::Django("0001_initial"));
    let database = open(&path).await;
    assert!(!worktrees_adopted(&database).await);
}

#[tokio::test]
async fn adopts_existing_rows_in_place_and_reopens_deterministically() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    fixture(&path);

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
    fixture(&path);
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
    fixture(&path);
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
    fixture(&path);
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
    fixture(&path);
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
