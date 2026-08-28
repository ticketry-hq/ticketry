use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use async_trait::async_trait;
use muxed_studio_lib::{
    run_now::{RunNowCaller, RunNowLauncher, RunNowRequest, RunNowRun, RunNowService},
    settings_persistence::ProfileStore,
    work_management::{
        entities::{issue, launch_policy_decision, transition_occurrence},
        launch_policy::{LaunchPolicyDecision, LaunchPolicyResolver},
        open_for_commands,
    },
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, EntityTrait, PaginatorTrait};

const PROJECT: &str = "20000000000000000000000000000000";
const STORY: &str = "30000000000000000000000000000000";
const MODULE_TYPE: &str = "30000000000000000000000000000001";
const IDEAS: &str = "40000000000000000000000000000000";
const IMPLEMENT: &str = "40000000000000000000000000000001";
const MODULE: &str = "50000000000000000000000000000000";
const TASK: &str = "60000000000000000000000000000000";
const PROVIDER: &str = "70000000000000000000000000000000";
const MODEL: &str = "80000000000000000000000000000000";
const CALLER_RUN: &str = "90000000000000000000000000000000";
const OTHER_RUN: &str = "90000000000000000000000000000001";

struct Fixture {
    _directory: tempfile::TempDir,
    database: DatabaseConnection,
    service: RunNowService,
    launches: Arc<AtomicUsize>,
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

async fn fixture(failure: Option<&str>) -> Fixture {
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
                agent_allowed bool NOT NULL,
                UNIQUE(issue_type_id, from_state_id, to_state_id)
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL, prompt text NOT NULL,
                required_skills text NOT NULL, model_id char(32), reasoning_id char(32),
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
                scope text NOT NULL, launch_state text, launch_model text
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
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL, 0,
                 'Module', 1, 0, 'M', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{STORY}', '{MODULE}', '{MODULE}', '{IDEAS}', 4,
                 'Small idea', 9, 0, 'N', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed)
                VALUES ('{STORY}', '{IDEAS}', '{IMPLEMENT}', 1);
            INSERT INTO worktracker_provider VALUES ('{PROVIDER}', 'codex', 1, 1);
            INSERT INTO worktracker_agentmodel VALUES ('{MODEL}', '{PROVIDER}', 'gpt-test');
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, model_id, reasoning_id,
                 auto_start, subtree_run_enabled, created_at, updated_at)
                VALUES ('{STORY}', '{IMPLEMENT}', 'Implement this Story.', '["tdd"]',
                        '{MODEL}', NULL, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    writer.close().await.unwrap();
    std::fs::write(
        directory.path().join("profiles.json"),
        format!(
            r#"{{"recent_profile_index":0,"profiles":[{{"name":"Local","workspace_slug":"meml","module_links":[{{"module_id":"{MODULE}","path":"{}"}}]}}]}}"#,
            directory.path().display()
        ),
    )
    .unwrap();
    let database = open_for_commands(&path).await.unwrap();
    let policy = LaunchPolicyResolver::new(
        database.clone(),
        ProfileStore::new(directory.path().join("profiles.json")),
    );
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

fn human(id_or_key: &str) -> RunNowRequest {
    RunNowRequest {
        id_or_key: id_or_key.to_owned(),
        request_identity: "request-1".to_owned(),
        caller: RunNowCaller::Human,
    }
}

async fn insert_live_run(database: &DatabaseConnection, id: &str) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope) \
             VALUES ('{id}', '{TASK}', 'codex', 'running', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
}

async fn state_id(database: &DatabaseConnection) -> Option<String> {
    issue::Entity::find_by_id(TASK)
        .one(database)
        .await
        .unwrap()
        .unwrap()
        .state_id
}

#[tokio::test]
async fn key_resolution_excludes_only_the_authenticated_caller_and_launches_after_commit() {
    let fixture = fixture(None).await;
    insert_live_run(&fixture.database, CALLER_RUN).await;
    fixture
        .database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions \
             (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) \
             VALUES ('{CALLER_RUN}', 'caller', '{TASK}', '{MODULE}', '{PROJECT}', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
    let success = fixture
        .service
        .execute(RunNowRequest {
            id_or_key: "meml-9".to_owned(),
            request_identity: "stable-mcp-request".to_owned(),
            caller: RunNowCaller::Agent {
                authenticated_run_id: CALLER_RUN.to_owned(),
            },
        })
        .await
        .unwrap();

    assert_eq!(success.code, "run_now_started");
    assert_eq!(success.committed_state.name, "Implement");
    assert_eq!(success.run.agent_run_id, "run-now-agent");
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        state_id(&fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );
    let decision = launch_policy_decision::Entity::find()
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(decision.caller_scope, "run_now");
    assert_eq!(decision.idempotency_key, "stable-mcp-request");
    assert!(decision.delivered_at.is_some());
    assert!(!decision.decision_json.contains("credential"));
    assert!(!decision.decision_json.contains("authorization"));
    assert!(!decision.decision_json.contains("command"));
    let occurrence = transition_occurrence::Entity::find()
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert!(occurrence.destination_auto_start);
    assert_eq!(
        occurrence.run_now_decision_id.as_deref(),
        Some(decision.decision_id.as_str())
    );
}

#[tokio::test]
async fn replay_returns_the_settled_run_without_repeating_the_transition_or_launch() {
    let fixture = fixture(None).await;
    let first = fixture.service.execute(human(TASK)).await.unwrap();
    let replay = fixture.service.execute(human(TASK)).await.unwrap();

    assert_eq!(replay, first);
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        launch_policy_decision::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn retry_resumes_a_claimed_failure_but_a_fresh_identity_cannot_adopt_implement() {
    let fixture = fixture(Some("terminal_runtime_unavailable")).await;
    let failure = fixture.service.execute(human(TASK)).await.unwrap_err();
    assert_eq!(failure.committed_state.unwrap().name, "Implement");
    assert_eq!(
        launch_policy_decision::Entity::find()
            .one(&fixture.database)
            .await
            .unwrap()
            .unwrap()
            .delivered_at,
        None
    );
    assert_eq!(
        muxed_studio_lib::work_management::launch_policy::pending(&fixture.database, 10)
            .await
            .unwrap()
            .len(),
        1
    );

    let mut fresh = human(TASK);
    fresh.request_identity = "fresh-request".to_owned();
    let refusal = fixture.service.execute(fresh).await.unwrap_err();
    assert_eq!(refusal.code, "run_now_not_eligible");

    let recovered = fixture.service.execute(human(TASK)).await.unwrap();
    assert_eq!(recovered.run.agent_run_id, "run-now-agent");
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 2);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn concurrent_same_and_distinct_identities_commit_one_claim_and_one_launch() {
    for distinct in [false, true] {
        let fixture = fixture(None).await;
        let first = human(TASK);
        let mut second = human(TASK);
        if distinct {
            second.request_identity = "request-2".to_owned();
        }
        let (left, right) = tokio::join!(
            fixture.service.execute(first),
            fixture.service.execute(second)
        );
        assert_eq!(
            usize::from(left.is_ok()) + usize::from(right.is_ok()),
            if distinct { 1 } else { 2 }
        );
        assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
        assert_eq!(
            transition_occurrence::Entity::find()
                .count(&fixture.database)
                .await
                .unwrap(),
            1
        );
        let occurrence = transition_occurrence::Entity::find()
            .one(&fixture.database)
            .await
            .unwrap()
            .unwrap();
        assert!(occurrence.run_now_decision_id.is_some());
    }
}

#[tokio::test]
async fn another_live_run_returns_the_stable_active_work_refusal_without_effects() {
    let live_run_fixture = fixture(None).await;
    insert_live_run(&live_run_fixture.database, CALLER_RUN).await;
    insert_live_run(&live_run_fixture.database, OTHER_RUN).await;
    let refusal = live_run_fixture
        .service
        .execute(RunNowRequest {
            id_or_key: TASK.to_owned(),
            request_identity: "request-live".to_owned(),
            caller: RunNowCaller::Agent {
                authenticated_run_id: CALLER_RUN.to_owned(),
            },
        })
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "task_already_active");
    assert!(refusal.committed_state.is_none());
    assert!(refusal.run.is_none());
    assert_eq!(live_run_fixture.launches.load(Ordering::SeqCst), 0);
    assert_eq!(
        state_id(&live_run_fixture.database).await.as_deref(),
        Some(IDEAS)
    );

    let live_terminal_fixture = fixture(None).await;
    live_terminal_fixture
        .database
        .execute_unprepared(&format!(
            "INSERT INTO agent_terminal_sessions \
             (agent_run_id, tmux_session_name, task_id, module_id, project_id, created_at, scope) \
             VALUES ('{OTHER_RUN}', 'other', '{TASK}', '{MODULE}', '{PROJECT}', CURRENT_TIMESTAMP, 'task')"
        ))
        .await
        .unwrap();
    let refusal = live_terminal_fixture
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "task_already_active");
    assert_eq!(
        state_id(&live_terminal_fixture.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(live_terminal_fixture.launches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn eligibility_origin_policy_skill_and_folder_refusals_precede_the_move() {
    let cases = [
        (
            "UPDATE worktracker_issuetype SET name = 'Task' WHERE id = '30000000000000000000000000000000'",
            "run_now_not_eligible",
            false,
        ),
        (
            "UPDATE worktracker_issuetypetransition SET agent_allowed = 0",
            "human_only_transition",
            true,
        ),
        (
            "DELETE FROM worktracker_launchbinding",
            "binding_not_configured",
            false,
        ),
        (
            "UPDATE worktracker_launchbinding SET required_skills = '[\"missing-skill\"]'",
            "invalid_required_skills",
            false,
        ),
        (
            "UPDATE worktracker_provider SET activated = 0",
            "provider_not_activated",
            false,
        ),
        (
            "DELETE FROM worktracker_agentmodel",
            "unsupported_model",
            false,
        ),
        (
            "UPDATE worktracker_issue SET parent_id = NULL, module_id = NULL WHERE id = '60000000000000000000000000000000'",
            "module_id_required",
            false,
        ),
    ];
    for (mutation, code, agent_origin) in cases {
        let fixture = fixture(None).await;
        fixture.database.execute_unprepared(mutation).await.unwrap();
        let mut request = human(TASK);
        request.request_identity = format!("request-{code}");
        if agent_origin {
            request.caller = RunNowCaller::Agent {
                authenticated_run_id: "authenticated-but-not-live".to_owned(),
            };
        }
        let refusal = fixture.service.execute(request).await.unwrap_err();
        assert_eq!(refusal.code, code);
        assert!(refusal.committed_state.is_none());
        assert_eq!(state_id(&fixture.database).await.as_deref(), Some(IDEAS));
        assert_eq!(fixture.launches.load(Ordering::SeqCst), 0);
    }

    let folder_fixture = fixture(None).await;
    std::fs::write(
        folder_fixture._directory.path().join("profiles.json"),
        format!(
            r#"{{"recent_profile_index":0,"profiles":[{{"name":"Local","workspace_slug":"meml","module_links":[{{"module_id":"{MODULE}","path":"/path/that/does/not/exist"}}]}}]}}"#
        ),
    )
    .unwrap();
    let refusal = folder_fixture
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "module_folder_unusable");
    assert_eq!(
        state_id(&folder_fixture.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(folder_fixture.launches.load(Ordering::SeqCst), 0);

    let profile_fixture = fixture(None).await;
    std::fs::write(
        profile_fixture._directory.path().join("profiles.json"),
        r#"{"recent_profile_index":null,"profiles":[]}"#,
    )
    .unwrap();
    let refusal = profile_fixture
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "profile_not_configured");
    assert_eq!(
        state_id(&profile_fixture.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(profile_fixture.launches.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn transition_failure_rolls_back_and_late_launch_failure_reports_the_commit() {
    let rejected_transition = fixture(None).await;
    rejected_transition
        .database
        .execute_unprepared(&format!(
            "CREATE TRIGGER reject_run_now BEFORE UPDATE OF state_id ON worktracker_issue \
             WHEN OLD.id = '{TASK}' BEGIN SELECT RAISE(ABORT, 'transition rejected'); END"
        ))
        .await
        .unwrap();
    let refusal = rejected_transition
        .service
        .execute(human(TASK))
        .await
        .unwrap_err();
    assert_eq!(refusal.code, "transition_rejected");
    assert!(refusal.committed_state.is_none());
    assert_eq!(
        state_id(&rejected_transition.database).await.as_deref(),
        Some(IDEAS)
    );
    assert_eq!(rejected_transition.launches.load(Ordering::SeqCst), 0);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&rejected_transition.database)
            .await
            .unwrap(),
        0
    );
    assert!(
        muxed_studio_lib::work_management::launch_policy::pending(
            &rejected_transition.database,
            10,
        )
        .await
        .unwrap()
        .is_empty(),
        "an unclaimed Run Now policy decision must not execute during startup reconciliation"
    );

    let fixture = fixture(Some("terminal_runtime_unavailable")).await;
    let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();
    assert_eq!(refusal.code, "launch_unavailable");
    assert_eq!(refusal.committed_state.unwrap().name, "Implement");
    assert!(refusal.run.is_none());
    assert_eq!(
        state_id(&fixture.database).await.as_deref(),
        Some(IMPLEMENT)
    );
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
}
