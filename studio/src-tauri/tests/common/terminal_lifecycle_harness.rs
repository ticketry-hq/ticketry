//! Desktop-runtime fixture for the Rust terminal lifecycle migration.
//!
//! The fixture owns the external resources, while product composition remains
//! real: Rust provisions `state.db`, composes it, and
//! the same GraphQL initializer used by the desktop installs the endpoint.

#![allow(dead_code)]

use std::fs;
use std::path::Path;
use std::sync::MutexGuard;

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use serde_json::Value;
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::graphql_foundation::{
    adopt_worktracker_and_install, ComposedCommandRuntime, InstallationOwnership,
};
use ticketry_runs::persistence::{publish_readiness, Slice3Readiness};
use ticketry_tool_discovery::{approve_executable_path, SupportedTool, ToolHealth};

use super::isolated_tmux::{IsolatedTmux, TmuxEnvironmentOverride, TMUX_ENV_LOCK};

pub const PROJECT_ID: &str = "00000000-0000-0000-0000-000000008641";
pub const MODULE_ID: &str = "00000000-0000-0000-0000-000000008644";
pub const TASK_ID: &str = "00000000-0000-0000-0000-000000008647";
pub const TASK_RUN_ID: &str = "terminal-harness-task";
pub const DOCUMENT_RUN_ID: &str = "terminal-harness-document";
pub const DOCUMENT_PATH: &str = "T864--terminal-harness/SPEC.md";

pub struct TerminalLifecycleHarness {
    _environment_lock: MutexGuard<'static, ()>,
    _environment: TmuxEnvironmentOverride,
    directory: tempfile::TempDir,
    pub tmux: IsolatedTmux,
    pub runtime_namespace: String,
    api: TransportApiImpl,
    runtime: Option<ComposedCommandRuntime>,
}

impl TerminalLifecycleHarness {
    pub async fn start() -> Self {
        let environment_lock = TMUX_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = tempfile::tempdir().expect("create terminal lifecycle directory");
        let tmux = IsolatedTmux::start_empty();
        let environment =
            TmuxEnvironmentOverride::set_with_data_directory(&tmux.socket_dir, directory.path());
        let runtime_namespace = provision(directory.path()).await;
        approve_disposable_provider(directory.path());
        let (api, runtime) = compose(directory.path()).await;
        Self {
            _environment_lock: environment_lock,
            _environment: environment,
            directory,
            tmux,
            runtime_namespace,
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
            InstallationOwnership::Owned,
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
        InstallationOwnership::Owned,
    )
    .await
    .expect("adopt and compose terminal lifecycle fixture");
    publish_readiness(data_directory, &Slice3Readiness::complete())
        .expect("open Runs GraphQL gate");
    (api, adopted.runtime)
}

async fn provision(data_directory: &Path) -> String {
    ticketry_installation::adoption::provisioning::provision(data_directory)
        .await
        .expect("provision the current Rust schema");
    let database = Database::connect(format!(
        "sqlite:{}?mode=rw",
        data_directory.join("state.db").display()
    ))
    .await
    .expect("open the Rust terminal fixture");
    let runtime_namespace = ticketry_terminal::tmux_adapter::current_runtime_namespace()
        .expect("derive the isolated tmux namespace");
    database
        .execute_unprepared(&format!(
            r#"
INSERT INTO worktracker_workspace VALUES ('00000000000000000000000000008640','terminal-harness','Terminal Harness','2026-08-19T12:00:00Z','2026-08-19T12:00:00Z',0);
UPDATE worktracker_provider SET activated = (slug = 'codex');
INSERT INTO worktracker_project VALUES ('00000000000000000000000000008641','Terminal Harness','T864','',864,'2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008640',0,0);
INSERT INTO worktracker_state VALUES ('00000000000000000000000000008642','Todo','unstarted','', '2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008641',1,0);
INSERT INTO worktracker_issuetype VALUES ('00000000000000000000000000008643','Module','module','',1,'2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008641','00000000000000000000000000008642',0,0);
INSERT INTO worktracker_issuetype VALUES ('00000000000000000000000000008645','Implementation','task','',2,'2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008641','00000000000000000000000000008642',0,0);
INSERT INTO worktracker_issue VALUES ('00000000000000000000000000008644','module','Harness module',1,'','2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008641','00000000000000000000000000008642',0,'a',0,'00000000000000000000000000008643',NULL,NULL);
INSERT INTO worktracker_issue VALUES ('00000000000000000000000000008647','task','Harness task',864,'','2026-08-19T12:00:00Z','2026-08-19T12:00:00Z','00000000000000000000000000008641','00000000000000000000000000008642',0,'b',0,'00000000000000000000000000008645',NULL,'00000000000000000000000000008644');
INSERT INTO agent_runs (id,ticket_seq,status,started_at,cwd,lifecycle_state,lifecycle_updated_at,scope,issue_id,agent) VALUES ('{TASK_RUN_ID}',864,'running','2026-08-19T12:00:00Z','{}','working','2026-08-19T12:00:00Z','task','00000000000000000000000000008647','codex');
INSERT INTO agent_runs (id,ticket_seq,status,started_at,cwd,lifecycle_state,lifecycle_updated_at,scope,issue_id,agent) VALUES ('{DOCUMENT_RUN_ID}',864,'running','2026-08-19T12:00:00Z','{}','working','2026-08-19T12:00:00Z','docchat','00000000000000000000000000008647','codex');
INSERT INTO agent_terminal_sessions VALUES ('{TASK_RUN_ID}','pt-{TASK_RUN_ID}','00000000000000000000000000008647','00000000000000000000000000008644','00000000000000000000000000008641','2026-08-19T12:00:00Z',NULL,'task',NULL,0,'{runtime_namespace}',NULL,0,'2026-08-19T12:00:00Z','codex');
INSERT INTO agent_terminal_sessions VALUES ('{DOCUMENT_RUN_ID}','pt-{DOCUMENT_RUN_ID}','00000000000000000000000000008647','00000000000000000000000000008644','00000000000000000000000000008641','2026-08-19T12:00:00Z',NULL,'docchat','{DOCUMENT_PATH}',0,'{runtime_namespace}',NULL,0,'2026-08-19T12:00:00Z','codex');
"#,
            data_directory.display(),
            data_directory.display(),
        ))
        .await
        .expect("seed the Rust terminal fixture");
    database
        .close()
        .await
        .expect("close the Rust terminal fixture");
    runtime_namespace
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
