//! The Slice 4 ownership handoff, from the outside.
//!
//! These cases assert what an operator can observe about the cutover: exactly
//! one production writer owns each transferred table, the composed manifest
//! names exactly what adoption installs, an unknown or drifted schema is refused
//! before the write lease changes hands, a partially ready runtime refuses
//! rather than degrading, and the published record states that no Django write
//! fallback exists.

use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use ticketry_workspace_runtime::handoff;
use ticketry_workspace_runtime::handoff::{
    manifest, publish_readiness, published_readiness_is_complete, Slice4Readiness,
    WorkspaceReadinessGate,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../..")
        .canonicalize()
        .unwrap()
}

/// A Django-shaped store at the current leaf, built by the real migrations so
/// adoption takes its production path rather than a shortcut this test wrote.
fn django_fixture(path: &Path) {
    let script = r#"
import os, sys
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from django.core.management import call_command
call_command('migrate', interactive=False, verbosity=0)
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
async fn the_manifest_names_exactly_the_tables_the_handoff_installs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    handoff::adopt(directory.path())
        .await
        .expect("adopt the workspace schema");
    let database = open(&path).await;

    for table in manifest::owned_tables() {
        let row = database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
                [table.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<i64>("", "count").unwrap(),
            1,
            "the manifest names {table}, which the handoff did not install"
        );
    }

    // The column shapes are part of the cutover contract, not a comment about
    // it: the same check runs at startup and refuses an unknown shape.
    manifest::validate_schema(&database)
        .await
        .expect("the adopted store must match the manifest it was validated against");
    database.close().await.unwrap();
}

/// Seed one Design Document and one Worktree through Django's own ORM, so the
/// pre-cutover store is referentially valid exactly as a real installation is.
/// Adoption refuses a store with foreign-key violations, and rightly so — a
/// hand-written row set would be testing a shape production never has.
fn seed_workspace_rows(path: &Path) {
    let script = r#"
import os, sys
from pathlib import Path
p=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(p); os.environ['MUXED_DATA_DIR']=str(p.parent); os.environ['MUXED_FORCE_SQLITE']='true'
import django; django.setup()
from worktracker.models import Issue, IssueType, Project, Workspace
from apps.documents.models import DesignDocument
from apps.worktrees.models import Worktree

workspace = Workspace.objects.create(id='0'*31+'1', name='Memory', slug='meml')
project = Project.objects.create(id='0'*31+'2', workspace=workspace, name='Coding', slug='CODIN', description='')
issue_type = IssueType.objects.create(id='0'*31+'3', project=project, name='Implementation', level='task', color='', sort_order=1)
issue = Issue.objects.create(id='0'*31+'4', project=project, issue_type=issue_type, type='task', name='Cut over', sequence_id=766, description='', rank='n', state_revision=0)

DesignDocument.objects.create(
    id='d1', module_id='m1', task_id=str(issue.id), scope='task',
    root_dir='/repos/ticketry/spec/mod--abc/T766--slug', rel_path='SPEC.md',
    discovered_by_run_id=None, created_at='2026-08-01', updated_at='2026-08-01',
)
Worktree.objects.create(
    id='w1', task_id=str(issue.id), workspace_slug='meml', project_id=str(project.id),
    module_id='m1', ticket_seq=766, repo_root='/repos/ticketry', path='/checkouts/t766',
    branch='wt/CODIN-766-cut-over', base_branch='main', base_commit='abc123',
    status='active', ephemeral=False, created_at='2026-08-01', updated_at='2026-08-01',
)
print(issue.id)
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

#[tokio::test]
async fn adoption_preserves_every_existing_document_and_worktree_row() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    seed_workspace_rows(&path);

    let evidence = handoff::adopt(directory.path())
        .await
        .expect("adopt the workspace schema");

    assert_eq!(evidence.document_rows, 1);
    assert_eq!(evidence.worktree_rows, 1);
    assert!(evidence.ownership_validated);

    // Existing identities, roots, relative paths, branches, base commits, and
    // timestamps survive the handoff unchanged: migration must not rewrite
    // workspace history.
    let database = open(&path).await;
    let document = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT root_dir, rel_path, content_digest FROM design_documents WHERE id='d1'",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        document.try_get::<String>("", "root_dir").unwrap(),
        "/repos/ticketry/spec/mod--abc/T766--slug"
    );
    assert_eq!(
        document.try_get::<String>("", "rel_path").unwrap(),
        "SPEC.md"
    );
    // The bridge's one new column is nullable and lazily populated, never
    // invented at adoption.
    assert!(document
        .try_get::<Option<String>>("", "content_digest")
        .unwrap()
        .is_none());

    let worktree = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT branch, base_commit, status, created_at FROM worktrees WHERE id='w1'",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        worktree.try_get::<String>("", "branch").unwrap(),
        "wt/CODIN-766-cut-over"
    );
    assert_eq!(
        worktree.try_get::<String>("", "base_commit").unwrap(),
        "abc123"
    );
    assert_eq!(worktree.try_get::<String>("", "status").unwrap(), "active");
    assert_eq!(
        worktree.try_get::<String>("", "created_at").unwrap(),
        "2026-08-01"
    );
    database.close().await.unwrap();
}

#[tokio::test]
async fn adoption_is_repeatable_across_a_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);

    let first = handoff::adopt(directory.path())
        .await
        .expect("adopt the workspace schema");
    // Reopening an already-adopted store must converge rather than re-bridge:
    // a restart is the ordinary case, not a second migration.
    let second = handoff::adopt(directory.path())
        .await
        .expect("re-adopt an already-owned store");

    assert_eq!(first, second);
}

#[tokio::test]
async fn adoption_refuses_an_unknown_documents_schema_before_the_lease_changes_hands() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    let database = open(&path).await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO django_migrations (app, name, applied) VALUES ('documents', ?, CURRENT_TIMESTAMP)",
            ["0099_a_migration_this_build_has_never_seen".into()],
        ))
        .await
        .unwrap();
    database.close().await.unwrap();

    let refusal = handoff::adopt(directory.path())
        .await
        .expect_err("an unknown Documents schema must be refused");

    assert_eq!(refusal.code_str(), "workspace_schema_unknown");
    // The refusal happens before any Documents write, so the pre-cutover store
    // is intact and the operator's snapshot is still the recovery path.
    assert!(!directory.path().join("documents-adoption.json").exists());
}

#[tokio::test]
async fn a_drifted_owned_table_is_refused_rather_than_written_through() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    django_fixture(&path);
    handoff::adopt(directory.path())
        .await
        .expect("adopt the workspace schema");

    let database = open(&path).await;
    database
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "ALTER TABLE worktrees ADD COLUMN a_column_this_build_never_owned text",
        ))
        .await
        .unwrap();

    let refusal = manifest::validate_schema(&database)
        .await
        .expect_err("a table this build does not own must be refused");

    assert_eq!(refusal.code_str(), "workspace_schema_unknown");
    database.close().await.unwrap();
}

#[tokio::test]
async fn the_readiness_gate_opens_only_for_the_complete_published_result() {
    let directory = tempfile::tempdir().unwrap();
    let gate = WorkspaceReadinessGate::watching(directory.path());

    assert!(!gate.is_ready(), "a missing record keeps the gate closed");

    publish_readiness(directory.path(), &Slice4Readiness::unavailable()).unwrap();
    assert!(!gate.is_ready());
    assert!(!published_readiness_is_complete(directory.path()));

    publish_readiness(directory.path(), &Slice4Readiness::complete()).unwrap();
    assert!(gate.is_ready());
    assert!(published_readiness_is_complete(directory.path()));
}

#[test]
fn a_partial_result_is_refused_rather_than_published() {
    let directory = tempfile::tempdir().unwrap();

    for close in [
        (|r: &mut Slice4Readiness| r.documents_ownership = false) as fn(&mut Slice4Readiness),
        |r: &mut Slice4Readiness| r.worktree_ownership = false,
        |r: &mut Slice4Readiness| r.operation_journal_ownership = false,
        |r: &mut Slice4Readiness| r.ownership_validated = false,
        |r: &mut Slice4Readiness| r.status_outbox = false,
        |r: &mut Slice4Readiness| r.operation_reconciliation = false,
        |r: &mut Slice4Readiness| r.authorized_roots = false,
        |r: &mut Slice4Readiness| r.graphql_workspace = false,
        |r: &mut Slice4Readiness| r.asset_protocol = false,
        |r: &mut Slice4Readiness| r.document_watch = false,
    ] {
        let mut partial = Slice4Readiness::complete();
        close(&mut partial);
        assert!(publish_readiness(directory.path(), &partial).is_err());
        assert!(!published_readiness_is_complete(directory.path()));
    }

    // There is no Django document or worktree writer to fall back to, and the
    // published record says so rather than leaving it implied.
    assert!(!Slice4Readiness::complete().django_write_fallback);
    assert!(!Slice4Readiness::unavailable().django_write_fallback);
}

#[test]
fn the_python_boundary_names_exactly_the_tables_rust_owns() {
    // The Django guard is the other half of the one-writer contract, and the two
    // halves must name the same surface. A table added to the Rust manifest and
    // forgotten in Python would be a silent second writer.
    let guard = std::fs::read_to_string(root().join("backend/apps/workspace_write_ownership.py"))
        .expect("the Python one-writer guard must ship");

    for table in manifest::owned_tables() {
        assert!(
            guard.contains(&format!("\"{table}\"")),
            "the Python boundary does not refuse writes to {table}"
        );
    }
}
