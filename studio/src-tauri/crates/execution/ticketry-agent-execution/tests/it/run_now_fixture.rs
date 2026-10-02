//! Shared Run Now service fixture: one Story in Ideas under a linked module.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, EntityTrait, PaginatorTrait};
use ticketry_agent_execution::run_now::{
    RunNowCaller, RunNowLauncher, RunNowRefusal, RunNowRequest, RunNowRun, RunNowService,
};
use ticketry_entities::{issue, launch_policy_decision, transition_occurrence};
use ticketry_work_management::{
    launch_policy::{LaunchPolicyDecision, LaunchPolicyResolver},
    open_for_commands,
};

pub(crate) const PROJECT: &str = "20000000000000000000000000000000";
pub(crate) const STORY: &str = "30000000000000000000000000000000";
pub(crate) const MODULE_TYPE: &str = "30000000000000000000000000000001";
pub(crate) const IMPLEMENTATION: &str = "30000000000000000000000000000002";
pub(crate) const IDEAS: &str = "40000000000000000000000000000000";
pub(crate) const IMPLEMENT: &str = "40000000000000000000000000000001";
pub(crate) const MODULE: &str = "50000000000000000000000000000000";
pub(crate) const TASK: &str = "60000000000000000000000000000000";
pub(crate) const PROVIDER: &str = "70000000000000000000000000000000";
pub(crate) const MODEL: &str = "80000000000000000000000000000000";
pub(crate) const IMPLEMENTATION_MODEL: &str = "80000000000000000000000000000001";
pub(crate) const CALLER_RUN: &str = "90000000000000000000000000000000";
pub(crate) const OTHER_RUN: &str = "90000000000000000000000000000001";

pub(crate) struct Fixture {
    _directory: tempfile::TempDir,
    pub(crate) database: DatabaseConnection,
    pub(crate) service: RunNowService,
    pub(crate) launches: Arc<AtomicUsize>,
}

struct RecordingLauncher {
    database: DatabaseConnection,
    launches: Arc<AtomicUsize>,
    failures_remaining: AtomicUsize,
    settled: Mutex<HashMap<String, RunNowRun>>,
}

#[async_trait]
impl RunNowLauncher for RecordingLauncher {
    async fn launch(&self, decision: &LaunchPolicyDecision) -> Result<RunNowRun, String> {
        let task = issue::Entity::find_by_id(TASK)
            .one(&self.database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(task.state_id.as_deref(), Some(IMPLEMENT));
        assert_eq!(task.issue_type_id, IMPLEMENTATION, "conversion commits before launch");
        let mut settled_runs = self.settled.lock().unwrap();
        if let Some(settled) = settled_runs.get(&decision.decision_id).cloned() {
            return Ok(settled);
        }
        self.launches.fetch_add(1, Ordering::SeqCst);
        if self
            .failures_remaining
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err("terminal_runtime_unavailable".to_owned());
        }
        let run = RunNowRun {
            target_id: decision.task_id.clone(),
            agent: decision.provider.clone(),
            agent_run_id: "run-now-agent".to_owned(),
        };
        settled_runs.insert(decision.decision_id.clone(), run.clone());
        Ok(run)
    }
}

pub(crate) async fn fixture(failure: Option<&str>) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA foreign_keys=ON;
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY(scope, "key")
            );
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                onboarding_required bool NOT NULL
            );
            CREATE TABLE worktracker_state (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, "group" varchar(32) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                is_protected bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issuetype (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, level varchar(16) NOT NULL,
                color varchar(32) NOT NULL, sort_order integer NOT NULL,
                start_state_id char(32), workflow_revision integer NOT NULL,
                is_pathfind bool NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_issue (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                type varchar(10) NOT NULL, issue_type_id char(32) NOT NULL,
                parent_id char(32), module_id char(32), state_id char(32),
                state_revision bigint NOT NULL, name varchar(512) NOT NULL,
                sequence_id integer NOT NULL, is_archived bool NOT NULL,
                rank varchar(64) NOT NULL, description text NOT NULL,
                workspace_tab_order text NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id)
            );
            CREATE TABLE worktracker_issue_blocked_by (
                id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
                to_issue_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_issuetypetransition (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
                agent_allowed bool NOT NULL, handoff bool NOT NULL DEFAULT 0,
                UNIQUE(issue_type_id, from_state_id, to_state_id)
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL, prompt text NOT NULL,
                required_skills text NOT NULL, stage_skills text NOT NULL DEFAULT '[]',
                profile varchar(128), model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(issue_type_id, state_id)
            );
            CREATE TABLE worktracker_provider (
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL,
                activated bool NOT NULL, supports_unattended bool NOT NULL
            );
            CREATE TABLE worktracker_agentmodel (
                id char(32) PRIMARY KEY, provider_id char(32) NOT NULL,
                name varchar(255) NOT NULL
            );
            CREATE TABLE worktracker_reasoninglevel (
                id char(32) PRIMARY KEY, name varchar(32) NOT NULL
            );
            CREATE TABLE worktracker_agentmodelreasoninglevel (
                id integer PRIMARY KEY AUTOINCREMENT,
                agent_model_id char(32) NOT NULL, reasoning_level_id char(32) NOT NULL
            );
            CREATE TABLE agent_runs (
                id text PRIMARY KEY, issue_id text NOT NULL, ticket_seq integer,
                agent text, model text, reasoning text, status text NOT NULL,
                started_at text NOT NULL, ended_at text, exit_code integer, error text,
                cwd text, provider_session_id text, lifecycle_state text,
                lifecycle_updated_at text, design_dir text, resumed_from text,
                scope text NOT NULL, launch_state text, launch_model text,
                initial_prompt text, launch_reasoning text,
                launch_unattended bool NOT NULL DEFAULT 0
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id text PRIMARY KEY, tmux_session_name text NOT NULL,
                task_id text NOT NULL, module_id text NOT NULL, project_id text NOT NULL,
                created_at text NOT NULL, terminated_at text, scope text NOT NULL,
                doc_rel_path text, runtime_cleanup_pending bool NOT NULL DEFAULT 0,
                runtime_namespace text, output_identity text,
                output_sequence bigint NOT NULL DEFAULT 0, last_output_at text,
                agent text
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Main', 'MEML', '', 9, 4, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{IDEAS}', '{PROJECT}', 'Ideas', 'backlog', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{IMPLEMENT}', '{PROJECT}', 'Implement', 'started', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{STORY}', '{PROJECT}', 'Story', 'task', '', 0, '{IDEAS}', 7, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{MODULE_TYPE}', '{PROJECT}', 'Module', 'module', '', 1, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{IMPLEMENTATION}', '{PROJECT}', 'Implementation', 'task', '', 2, '{IMPLEMENT}',
                 3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL, 0,
                 'Module', 1, 0, 'M', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{STORY}', '{MODULE}', '{MODULE}', '{IDEAS}', 4,
                 'Small idea', 9, 0, 'N', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed)
                VALUES ('{STORY}', '{IDEAS}', '{IMPLEMENT}', 1);
            INSERT INTO worktracker_provider VALUES ('{PROVIDER}', 'codex', 1, 1);
            INSERT INTO worktracker_agentmodel VALUES
                ('{MODEL}', '{PROVIDER}', 'gpt-test'),
                ('{IMPLEMENTATION_MODEL}', '{PROVIDER}', 'gpt-implementation');
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, model_id, reasoning_id,
                 auto_start, subtree_run_enabled, created_at, updated_at)
                VALUES ('{STORY}', '{IMPLEMENT}', 'Implement this Story.', '["tdd"]',
                        '{MODEL}', NULL, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                       ('{IMPLEMENTATION}', '{IMPLEMENT}', 'Implement this task.', '["tdd"]',
                        '{IMPLEMENTATION_MODEL}', NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    writer.close().await.unwrap();
    std::fs::write(
        directory.path().join("profiles.json"),
        r#"{"recent_profile_index":0,"profiles":[{"name":"Local","workspace_slug":"meml"}]}"#,
    )
    .unwrap();
    let database = open_for_commands(&path).await.unwrap();
    // The folder a launch runs in is the module's typed link, so the policy
    // resolves it from the installation rather than from the profile.
    link_module(&database, &directory.path().display().to_string()).await;
    let policy = LaunchPolicyResolver::new(database.clone());
    let launches = Arc::new(AtomicUsize::new(0));
    let service = RunNowService::with_launcher(
        database.clone(),
        policy,
        Arc::new(RecordingLauncher {
            database: database.clone(),
            launches: launches.clone(),
            failures_remaining: AtomicUsize::new(usize::from(failure.is_some())),
            settled: Mutex::new(HashMap::new()),
        }),
        None,
    );
    Fixture {
        _directory: directory,
        database,
        service,
        launches,
    }
}

/// Point the fixture module at one local folder, through the one write seam.
pub(crate) async fn link_module(database: &DatabaseConnection, folder: &str) {
    ticketry_work_management::schema::install(database)
        .await
        .expect("install the Module Link schema");
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, folder)
        .await
        .expect("link the fixture module");
}

pub(crate) fn human(id_or_key: &str) -> RunNowRequest {
    RunNowRequest {
        id_or_key: id_or_key.to_owned(),
        request_identity: "request-1".to_owned(),
        caller: RunNowCaller::Human,
    }
}

pub(crate) async fn insert_live_run(database: &DatabaseConnection, id: &str) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) \
             VALUES ('{id}', '{TASK}', 'codex', 'running', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
}

pub(crate) async fn state_id(database: &DatabaseConnection) -> Option<String> {
    issue::Entity::find_by_id(TASK)
        .one(database)
        .await
        .unwrap()
        .unwrap()
        .state_id
}
