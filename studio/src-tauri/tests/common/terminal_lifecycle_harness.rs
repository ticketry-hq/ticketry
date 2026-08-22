//! Desktop-runtime fixture for the Rust terminal lifecycle migration.
//!
//! The fixture owns the external resources, while product composition remains
//! real: current Django migrations provision `state.db`, Rust adopts it, and
//! the same GraphQL initializer used by the desktop installs the endpoint.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::MutexGuard;

use muxed_studio_lib::graphql_foundation::{adopt_worktracker_and_install, ComposedCommandRuntime};
use muxed_studio_lib::runs_persistence::{publish_readiness, Slice3Readiness};
use muxed_studio_lib::tool_discovery::{approve_executable_path, SupportedTool, ToolHealth};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use serde_json::Value;
use tauri_graphql::{TransportApi, TransportApiImpl};

use super::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, TMUX_ENV_LOCK};

pub const PROJECT_ID: &str = "00000000-0000-0000-0000-000000008641";
pub const MODULE_ID: &str = "00000000-0000-0000-0000-000000008644";
pub const TASK_ID: &str = "00000000-0000-0000-0000-000000008647";
pub const TASK_RUN_ID: &str = "terminal-harness-task";
pub const DOCUMENT_RUN_ID: &str = "terminal-harness-document";
pub const DOCUMENT_PATH: &str = "T864--terminal-harness/SPEC.md";
pub const RUNTIME_NAMESPACE: &str = "tmux-characterization-864";

pub struct TerminalLifecycleHarness {
    _environment_lock: MutexGuard<'static, ()>,
    _environment: TmuxEnvironmentOverride,
    directory: tempfile::TempDir,
    pub tmux: IsolatedTmux,
    api: TransportApiImpl,
    runtime: Option<ComposedCommandRuntime>,
}

impl TerminalLifecycleHarness {
    pub async fn start() -> Self {
        let environment_lock = TMUX_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().expect("create terminal lifecycle directory");
        provision(directory.path());
        let tmux = IsolatedTmux::start_empty();
        let environment =
            TmuxEnvironmentOverride::set_with_data_directory(&tmux.socket_dir, directory.path());
        approve_disposable_provider(directory.path());
        let (api, runtime) = compose(directory.path()).await;
        Self {
            _environment_lock: environment_lock,
            _environment: environment,
            directory,
            tmux,
            api,
            runtime: Some(runtime),
        }
    }

    pub fn data_directory(&self) -> &Path {
        self.directory.path()
    }

    pub async fn graphql(&self, query: &str, variables: Value) -> Value {
        let request = serde_json::json!({"query": query, "variables": variables}).to_string();
        serde_json::from_str(&self.api.clone().graphql_execute(request).await)
            .expect("decode terminal GraphQL response")
    }

    pub async fn database(&self) -> DatabaseConnection {
        Database::connect(format!(
            "sqlite:{}?mode=rw",
            self.directory.path().join("state.db").display()
        ))
        .await
        .expect("open terminal lifecycle database")
    }

    pub async fn terminal_facts(&self) -> Vec<TerminalFact> {
        let database = self.database().await;
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT agent_run_id, tmux_session_name, task_id, module_id, project_id, \
                 runtime_namespace, scope, doc_rel_path, terminated_at \
                 FROM agent_terminal_sessions ORDER BY agent_run_id",
            ))
            .await
            .expect("read durable terminal facts");
        rows.into_iter()
            .map(|row| TerminalFact {
                agent_run_id: row.try_get("", "agent_run_id").unwrap(),
                tmux_session_name: row.try_get("", "tmux_session_name").unwrap(),
                task_id: row.try_get("", "task_id").unwrap(),
                module_id: row.try_get("", "module_id").unwrap(),
                project_id: row.try_get("", "project_id").unwrap(),
                runtime_namespace: row.try_get("", "runtime_namespace").unwrap(),
                scope: row.try_get("", "scope").unwrap(),
                doc_rel_path: row.try_get("", "doc_rel_path").unwrap(),
                terminated_at: row.try_get("", "terminated_at").unwrap(),
            })
            .collect()
    }

    pub async fn restart(&mut self) {
        self.runtime.take();
        self.api = TransportApiImpl::new();
        let adopted = adopt_worktracker_and_install(
            &self.directory.path().join("rust-core.sqlite3"),
            self.directory.path(),
            &self.api,
        )
        .await
        .expect("reopen adopted terminal runtime");
        publish_readiness(self.directory.path(), &Slice3Readiness::complete())
            .expect("reopen Runs GraphQL gate");
        self.runtime = Some(adopted.runtime);
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct TerminalFact {
    pub agent_run_id: String,
    pub tmux_session_name: String,
    pub task_id: String,
    pub module_id: String,
    pub project_id: String,
    pub runtime_namespace: Option<String>,
    pub scope: String,
    pub doc_rel_path: Option<String>,
    pub terminated_at: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LifecycleBoundary {
    Durable(&'static str),
    ExternalEffect(&'static str),
}

#[derive(Debug, Eq, PartialEq)]
pub struct InjectedStop(pub LifecycleBoundary);

pub struct StopController {
    stop_at: LifecycleBoundary,
}

impl StopController {
    pub fn at(stop_at: LifecycleBoundary) -> Self {
        Self { stop_at }
    }

    pub fn checkpoint(&self, boundary: LifecycleBoundary) -> Result<(), InjectedStop> {
        if boundary == self.stop_at {
            Err(InjectedStop(boundary))
        } else {
            Ok(())
        }
    }
}

async fn compose(data_directory: &Path) -> (TransportApiImpl, ComposedCommandRuntime) {
    let api = TransportApiImpl::new();
    let adopted = adopt_worktracker_and_install(
        &data_directory.join("rust-core.sqlite3"),
        data_directory,
        &api,
    )
    .await
    .expect("adopt and compose terminal lifecycle fixture");
    publish_readiness(data_directory, &Slice3Readiness::complete())
        .expect("open Runs GraphQL gate");
    (api, adopted.runtime)
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

fn provision(data_directory: &Path) {
    let script = r#"
import os, sys
from pathlib import Path
db_path=Path(sys.argv[1]).resolve(); os.environ['DJANGO_SETTINGS_MODULE']='studio_server.settings'; os.environ['MUXED_STATE_DB']=str(db_path); os.environ['MUXED_DATA_DIR']=str(db_path.parent); os.environ['MUXED_FORCE_SQLITE']='true'
from studio_server import settings
settings.INSTALLED_APPS = [*settings.INSTALLED_APPS, 'apps.terminals']
import django; django.setup()
from django.core.management import call_command
from worktracker.models import Workspace, Project, State, IssueType, Issue
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
call_command('migrate', interactive=False, verbosity=0)
w=Workspace.objects.create(id='00000000000000000000000000008640', slug='terminal-harness', name='Terminal Harness')
project=Project.objects.create(id='00000000000000000000000000008641', workspace=w, name='Terminal Harness', slug='T864', seq_counter=864)
s=State.objects.create(id='00000000000000000000000000008642', project=project, name='Todo', group='unstarted', sort_order=1)
module_type=IssueType.objects.create(id='00000000000000000000000000008643', project=project, name='Module', level='module', sort_order=1, start_state=s)
module=Issue.objects.create(id='00000000000000000000000000008644', project=project, type='module', issue_type=module_type, state=s, name='Harness module', sequence_id=1, rank='a')
task_type=IssueType.objects.create(id='00000000000000000000000000008645', project=project, name='Implementation', level='task', sort_order=2, start_state=s)
task=Issue.objects.create(id='00000000000000000000000000008647', project=project, module=module, type='task', issue_type=task_type, state=s, name='Harness task', sequence_id=864, rank='b')
for run_id, scope, doc in [('terminal-harness-task', 'task', None), ('terminal-harness-document', 'docchat', 'T864--terminal-harness/SPEC.md')]:
    run=AgentRun.objects.create(id=run_id, issue=task, ticket_seq=864, agent='codex', status='running', started_at='2026-08-19T12:00:00Z', cwd=str(db_path.parent), lifecycle_state='working', lifecycle_updated_at='2026-08-19T12:00:00Z', scope=scope)
    AgentTerminalSession.objects.create(agent_run=run, tmux_session_name='pt-'+run_id, task_id=str(task.id), module_id=str(module.id), project_id=str(project.id), agent='codex', created_at='2026-08-19T12:00:00Z', last_output_at='2026-08-19T12:00:00Z', runtime_namespace='tmux-characterization-864', scope=scope, doc_rel_path=doc)
# Slice 3 owns the Runs schema at this named leaf. Newer Django-only columns
# coexist on the branch for the temporary compatibility sidecar, but are not
# part of the database generation Rust adopts.
from django.db import connection
with connection.cursor() as cursor:
    # The compatibility backend no longer installs the retired Execution app.
    # Model the oldest supported empty source so Rust can exercise its named
    # adoption bridge before composing the terminal lifecycle fixture.
    cursor.execute('CREATE TABLE engine_runs (task_id varchar(32) PRIMARY KEY)')
    cursor.execute("INSERT INTO django_migrations (app, name, applied) VALUES ('execution', '0001_initial', CURRENT_TIMESTAMP)")
    cursor.execute('ALTER TABLE agent_runs DROP COLUMN launch_state')
    cursor.execute('ALTER TABLE agent_runs DROP COLUMN launch_model')
    cursor.execute("DELETE FROM django_migrations WHERE app='runs' AND name IN ('0013_agentrun_optional_agent', '0014_agentrun_launch_metadata', '0015_merge_20260819_1521')")
"#;
    let output = Command::new(repository_root().join("backend/.venv/bin/python"))
        .arg("-c")
        .arg(script)
        .arg(data_directory.join("state.db"))
        .current_dir(repository_root())
        .output()
        .expect("run current Django migrations for terminal fixture");
    assert!(
        output.status.success(),
        "terminal fixture provisioning failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn approve_disposable_provider(data_directory: &Path) {
    let bin = data_directory.join("approved-bin");
    fs::create_dir(&bin).expect("create disposable executable directory");
    let executable = bin.join("codex");
    fs::write(
        &executable,
        b"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex 864.0.0\\n'; exit 0; fi\nprintf 'TERMINAL_HARNESS_PROVIDER\\n'\n",
    )
    .expect("write disposable provider");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("make disposable provider executable");
    }
    let approved = approve_executable_path(SupportedTool::Codex, executable)
        .expect("approve disposable provider through the product boundary");
    assert_eq!(approved.health, ToolHealth::Ready);
}
