use muxed_studio_lib::{
    settings_persistence::ProfileStore,
    work_management::{
        launch_policy::{self, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver},
        open_for_commands,
    },
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};

const WORKSPACE: &str = "10000000000000000000000000000000";
const PROJECT: &str = "20000000000000000000000000000000";
const TYPE: &str = "30000000000000000000000000000000";
const STATE: &str = "40000000000000000000000000000000";
const MODULE: &str = "50000000000000000000000000000000";
const TASK: &str = "60000000000000000000000000000000";
const CODEX: &str = "70000000000000000000000000000000";
const CLAUDE: &str = "70000000000000000000000000000001";
const DISABLED: &str = "70000000000000000000000000000002";
const INTERACTIVE: &str = "70000000000000000000000000000003";
const GPT: &str = "80000000000000000000000000000000";
const OPUS: &str = "80000000000000000000000000000001";
const DISABLED_MODEL: &str = "80000000000000000000000000000002";
const INTERACTIVE_MODEL: &str = "80000000000000000000000000000003";
const HIGH: &str = "90000000000000000000000000000000";
const LOW: &str = "90000000000000000000000000000001";

async fn fixture() -> (tempfile::TempDir, DatabaseConnection, LaunchPolicyResolver) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    writer
        .execute_unprepared(&format!(
            r#"
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY(scope, "key")
            );
            CREATE TABLE worktracker_workspace (
                id char(32) PRIMARY KEY, slug varchar(48) NOT NULL,
                name varchar(255) NOT NULL, onboarding_required bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY, workspace_id char(32) NOT NULL,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
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
                created_at datetime NOT NULL, updated_at datetime NOT NULL
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
                agent_model_id char(32) NOT NULL,
                reasoning_level_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT,
                issue_type_id char(32) NOT NULL, state_id char(32) NOT NULL,
                prompt text NOT NULL, required_skills text NOT NULL,
                model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE automation_attempts (
                id text PRIMARY KEY, transition_id text NOT NULL,
                issue_id text NOT NULL, from_state_id text NOT NULL,
                to_state_id text NOT NULL, workflow_revision integer NOT NULL,
                status text NOT NULL, agent text, agent_run_id text, error text,
                error_details text, retryable bool NOT NULL DEFAULT 1,
                dismissed_at text, retry_of_id text, root_attempt_id text,
                created_at text NOT NULL, updated_at text NOT NULL
            );
            CREATE UNIQUE INDEX uniq_auto_attempt_transition_root
                ON automation_attempts(transition_id) WHERE retry_of_id IS NULL;
            CREATE TABLE runs_status_events (
                cursor integer PRIMARY KEY AUTOINCREMENT,
                event_id text NOT NULL UNIQUE, project_id text NOT NULL,
                event_kind text NOT NULL, payload_version integer NOT NULL,
                subject_kind text NOT NULL, subject_id text NOT NULL,
                agent_run_id text, automation_attempt_id text,
                work_item_id text, payload text NOT NULL,
                committed_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO worktracker_workspace VALUES
                ('{WORKSPACE}', 'meml', 'Memory', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', '{WORKSPACE}', 'Main', 'MAIN', '', 2, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_state VALUES
                ('{STATE}', '{PROJECT}', 'Implement', 'started', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{TYPE}', '{PROJECT}', 'Implementation', 'task', '', 0, '{STATE}', 17, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{TYPE}', NULL, NULL, NULL, 0,
                 'Module', 1, 0, 'M', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{TYPE}', '{MODULE}', '{MODULE}', '{STATE}', 0,
                 'Task', 2, 0, 'N', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_provider VALUES
                ('{CODEX}', 'codex', 1, 1),
                ('{CLAUDE}', 'claude', 1, 1),
                ('{DISABLED}', 'disabled', 0, 1),
                ('{INTERACTIVE}', 'interactive', 1, 0);
            INSERT INTO worktracker_agentmodel VALUES
                ('{GPT}', '{CODEX}', 'gpt-5.6'),
                ('{OPUS}', '{CLAUDE}', 'opus'),
                ('{DISABLED_MODEL}', '{DISABLED}', 'disabled-model'),
                ('{INTERACTIVE_MODEL}', '{INTERACTIVE}', 'interactive-model');
            INSERT INTO worktracker_reasoninglevel VALUES
                ('{HIGH}', 'high'), ('{LOW}', 'low');
            INSERT INTO worktracker_agentmodelreasoninglevel
                (agent_model_id, reasoning_level_id) VALUES
                ('{GPT}', '{HIGH}'), ('{OPUS}', '{LOW}');
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, model_id, reasoning_id,
                 auto_start, subtree_run_enabled, created_at, updated_at)
                VALUES ('{TYPE}', '{STATE}', 'Implement it.', '["tdd"]', NULL, NULL, 1, 1,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog',
                 '{{"global_default":{{"provider":"codex","model":"gpt-5.6","reasoning":"high"}}}}',
                 CURRENT_TIMESTAMP);
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
    let resolver = LaunchPolicyResolver::new(
        database.clone(),
        ProfileStore::new(directory.path().join("profiles.json")),
    );
    (directory, database, resolver)
}

fn request(scope: CallerScope, key: &str) -> LaunchPolicyRequest {
    LaunchPolicyRequest {
        task_id: TASK.to_owned(),
        destination_state_id: None,
        provider_override: None,
        caller_scope: scope,
        idempotency_key: key.to_owned(),
    }
}

#[tokio::test]
async fn all_doors_share_one_complete_versioned_snapshot() {
    let (directory, _database, resolver) = fixture().await;
    let expected_folder = directory.path().display().to_string();
    for scope in [
        CallerScope::Interactive,
        CallerScope::AutoStart,
        CallerScope::Subtree,
    ] {
        let decision = resolver
            .resolve(request(scope, scope.as_str()))
            .await
            .unwrap();
        assert_eq!(decision.version, 2);
        assert_eq!(decision.policy_identity, "launch-binding:1");
        assert_eq!(decision.policy_version, 17);
        assert_eq!(decision.state_name.as_deref(), Some("Implement"));
        assert_eq!(
            decision.task_id,
            uuid::Uuid::parse_str(TASK).unwrap().to_string()
        );
        assert_eq!(decision.prompt, "Implement it.");
        assert_eq!(decision.required_skills, ["tdd"]);
        assert_eq!(
            (
                decision.provider.as_str(),
                decision.model.as_deref(),
                decision.reasoning.as_deref()
            ),
            ("codex", Some("gpt-5.6"), Some("high"))
        );
        assert_eq!(decision.selected_profile.index, 0);
        assert_eq!(decision.selected_profile.workspace_slug, "meml");
        assert_eq!(
            decision.module_link.module_id,
            uuid::Uuid::parse_str(MODULE).unwrap().to_string()
        );
        assert_eq!(
            decision.module_link.path.as_deref(),
            Some(expected_folder.as_str())
        );
        assert_eq!(decision.caller_scope, scope);
        assert_eq!(decision.idempotency_key, scope.as_str());
    }
}

#[tokio::test]
async fn explicit_provider_never_inherits_another_providers_defaults() {
    let (_directory, database, resolver) = fixture().await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_launchbinding SET model_id = '{OPUS}', reasoning_id = NULL"
        ))
        .await
        .unwrap();

    let decision = resolver
        .resolve(request(CallerScope::Interactive, "explicit"))
        .await
        .unwrap();

    assert_eq!(decision.provider, "claude");
    assert_eq!(decision.model.as_deref(), Some("opus"));
    assert_eq!(decision.reasoning, None);
}

#[tokio::test]
async fn resolution_rejects_every_established_policy_failure_code() {
    let mutations = [
        ("UPDATE worktracker_issue SET state_id = NULL", "launch_context_incomplete"),
        ("UPDATE worktracker_launchbinding SET prompt = '', required_skills = '[]', model_id = NULL, reasoning_id = NULL", "binding_not_configured"),
        (&format!("UPDATE worktracker_launchbinding SET prompt = '', model_id = '{GPT}'"), "prompt_not_configured"),
        ("UPDATE worktracker_launchbinding SET required_skills = '[\"future\"]'", "invalid_required_skills"),
        (&format!("UPDATE worktracker_launchbinding SET model_id = '{DISABLED_MODEL}'"), "provider_not_activated"),
        (&format!("UPDATE worktracker_launchbinding SET model_id = '{GPT}', reasoning_id = '{LOW}'"), "unsupported_reasoning"),
    ];
    for (sql, code) in mutations {
        let (_directory, database, resolver) = fixture().await;
        database.execute_unprepared(sql).await.unwrap();
        let error = resolver
            .resolve(request(CallerScope::Interactive, code))
            .await
            .unwrap_err();
        assert_eq!(error.code(), code);
    }

    let (_directory, database, resolver) = fixture().await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_launchbinding SET model_id = '{INTERACTIVE_MODEL}'"
        ))
        .await
        .unwrap();
    let error = resolver
        .resolve(request(CallerScope::AutoStart, "unattended"))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "unattended_launch_unsupported");
}

#[tokio::test]
async fn resolution_rejects_every_unusable_selected_module_folder() {
    let cases = ["unset", "relative", "missing", "file"];
    for case in cases {
        let (directory, _database, resolver) = fixture().await;
        let path = match case {
            "unset" => String::new(),
            "relative" => "relative/repository".to_owned(),
            "missing" => directory.path().join("missing").display().to_string(),
            "file" => {
                let path = directory.path().join("regular-file");
                std::fs::write(&path, b"not a directory").unwrap();
                path.display().to_string()
            }
            _ => unreachable!(),
        };
        std::fs::write(
            directory.path().join("profiles.json"),
            format!(
                r#"{{"recent_profile_index":0,"profiles":[{{"name":"Local","workspace_slug":"meml","module_links":[{{"module_id":"{MODULE}","path":{}}}]}}]}}"#,
                serde_json::to_string(&path).unwrap(),
            ),
        )
        .unwrap();

        let error = resolver
            .resolve(request(CallerScope::Interactive, case))
            .await
            .unwrap_err();
        assert_eq!(error.code(), "module_folder_unusable", "{case}");
    }
}

#[tokio::test]
async fn resolution_rejects_when_no_profile_is_selected() {
    let (directory, _database, resolver) = fixture().await;
    std::fs::write(
        directory.path().join("profiles.json"),
        r#"{"recent_profile_index":null,"profiles":[]}"#,
    )
    .unwrap();

    let error = resolver
        .resolve(request(CallerScope::Interactive, "no-profile"))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "profile_not_configured");
}

#[cfg(unix)]
#[tokio::test]
async fn resolution_rejects_an_inaccessible_selected_module_folder() {
    use std::os::unix::fs::PermissionsExt;

    let (directory, _database, resolver) = fixture().await;
    let blocked = directory.path().join("blocked");
    std::fs::create_dir(&blocked).unwrap();
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::write(
        directory.path().join("profiles.json"),
        format!(
            r#"{{"recent_profile_index":0,"profiles":[{{"name":"Local","workspace_slug":"meml","module_links":[{{"module_id":"{MODULE}","path":{}}}]}}]}}"#,
            serde_json::to_string(&blocked.display().to_string()).unwrap(),
        ),
    )
    .unwrap();

    let error = resolver
        .resolve(request(CallerScope::Interactive, "inaccessible"))
        .await
        .unwrap_err();
    assert_eq!(error.code(), "module_folder_unusable");
    std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o700)).unwrap();
}

#[tokio::test]
async fn unattended_doors_honor_committed_auto_start_and_live_subtree_policy() {
    let (_directory, database, resolver) = fixture().await;
    database
        .execute_unprepared(
            "UPDATE worktracker_launchbinding SET auto_start = 0, subtree_run_enabled = 0",
        )
        .await
        .unwrap();
    assert!(resolver
        .resolve(request(CallerScope::AutoStart, "auto"))
        .await
        .is_ok());
    assert_eq!(
        resolver
            .resolve(request(CallerScope::Subtree, "subtree"))
            .await
            .unwrap_err()
            .code(),
        "subtree_run_not_enabled"
    );
    assert!(resolver
        .resolve(request(CallerScope::Interactive, "interactive"))
        .await
        .is_ok());
}

#[tokio::test]
async fn global_default_changes_apply_once_to_the_next_decision() {
    let (_directory, database, resolver) = fixture().await;
    let first = resolver
        .resolve(request(CallerScope::Interactive, "first"))
        .await
        .unwrap();
    database
        .execute_unprepared(
            r#"UPDATE app_settings SET value = '{"global_default":{"provider":"claude","model":"opus","reasoning":"low"}}' WHERE scope = 'host' AND "key" = 'provider_catalog'"#,
        )
        .await
        .unwrap();
    let second = resolver
        .resolve(request(CallerScope::Interactive, "second"))
        .await
        .unwrap();
    assert_eq!(
        (first.provider.as_str(), first.model.as_deref()),
        ("codex", Some("gpt-5.6"))
    );
    assert_eq!(
        (
            second.provider.as_str(),
            second.model.as_deref(),
            second.reasoning.as_deref()
        ),
        ("claude", Some("opus"), Some("low"))
    );
}

#[tokio::test]
async fn compatibility_failure_and_restart_keep_one_pending_identity() {
    let (directory, database, resolver) = fixture().await;
    let decision = resolver
        .resolve(request(CallerScope::Interactive, "request-1"))
        .await
        .unwrap();
    let recorded = launch_policy::record(&database, &decision).await.unwrap();
    let duplicate = launch_policy::record(&database, &decision).await.unwrap();
    assert_eq!(recorded.decision_id, duplicate.decision_id);
    assert_eq!(
        launch_policy::pending(&database, 10).await.unwrap().len(),
        1
    );
    database.close().await.unwrap();

    let reopened = open_for_commands(&directory.path().join("state.db"))
        .await
        .unwrap();
    let pending = launch_policy::pending(&reopened, 10).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].idempotency_key, "request-1");
    launch_policy::mark_delivered(&reopened, &pending[0].decision_id)
        .await
        .unwrap();
    assert!(launch_policy::pending(&reopened, 10)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn auto_start_occurrences_become_decisions_or_recoverable_rejections() {
    let (_directory, database, resolver) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_transitionoccurrence (
                occurrence_id, version, issue_id, project_id, issue_type_id,
                from_state_id, to_state_id, from_group, to_group,
                work_item_revision, workflow_revision, destination_auto_start
            ) VALUES (
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                '{STATE}', '{STATE}', 'started', 'started', 1, 17, 1
            ), (
                'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                '{STATE}', '{STATE}', 'started', 'started', 2, 17, 0
            )
            "#
        ))
        .await
        .unwrap();

    let decisions = launch_policy::prepare_pending_auto_starts(&database, &resolver, 10)
        .await
        .unwrap();
    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].caller_scope, CallerScope::AutoStart);
    assert_eq!(
        decisions[0].idempotency_key,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    let attempt_count = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM automation_attempts WHERE transition_id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(attempt_count, 1);
    let all_attempts = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM automation_attempts".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(all_attempts, 1, "inert occurrences create no attempt");

    database
        .execute_unprepared(&format!(
            r#"
            UPDATE worktracker_launchbinding SET auto_start = 0;
            INSERT INTO worktracker_transitionoccurrence (
                occurrence_id, version, issue_id, project_id, issue_type_id,
                from_state_id, to_state_id, from_group, to_group,
                work_item_revision, workflow_revision, destination_auto_start
            ) VALUES (
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                '{STATE}', '{STATE}', 'started', 'started', 2, 17, 1
            );
            "#
        ))
        .await
        .unwrap();
    let immutable = launch_policy::prepare_pending_auto_starts(&database, &resolver, 10)
        .await
        .unwrap();
    assert_eq!(immutable.len(), 1);
    assert_eq!(
        immutable[0].idempotency_key,
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );

    database
        .execute_unprepared(&format!(
            r#"
            UPDATE worktracker_launchbinding SET prompt = '';
            INSERT INTO worktracker_transitionoccurrence (
                occurrence_id, version, issue_id, project_id, issue_type_id,
                from_state_id, to_state_id, from_group, to_group,
                work_item_revision, workflow_revision, destination_auto_start
            ) VALUES (
                'cccccccccccccccccccccccccccccccc', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                '{STATE}', '{STATE}', 'started', 'started', 3, 17, 1
            );
            "#
        ))
        .await
        .unwrap();
    assert!(
        launch_policy::prepare_pending_auto_starts(&database, &resolver, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let row = database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "SELECT code FROM ticketry_launchpolicyrejection WHERE idempotency_key = 'cccccccccccccccccccccccccccccccc'"
                .to_owned(),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        row.try_get::<String>("", "code").unwrap(),
        "prompt_not_configured"
    );

    // The rejection is a diagnosis, not a verdict: it is readable against the
    // work item it blocks, and repairing the binding re-queues the occurrence
    // instead of leaving it filtered out forever.
    let rejections = launch_policy::rejections_for_work_item(&database, TASK)
        .await
        .unwrap();
    assert_eq!(rejections.len(), 1);
    assert_eq!(rejections[0].code, "prompt_not_configured");
    assert!(rejections[0].recoverable);
    assert_eq!(
        rejections[0].occurrence_id,
        "cccccccccccccccccccccccccccccccc"
    );

    database
        .execute_unprepared(
            r#"
            UPDATE worktracker_launchbinding SET prompt = 'Implement it.';
            UPDATE ticketry_launchpolicyrejection
                SET rejected_at = datetime('now', '-1 hour');
            "#,
        )
        .await
        .unwrap();
    let recovered = launch_policy::prepare_pending_auto_starts(&database, &resolver, 10)
        .await
        .unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(
        recovered[0].idempotency_key,
        "cccccccccccccccccccccccccccccccc"
    );
    assert!(launch_policy::rejections_for_work_item(&database, TASK)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn auto_start_backlog_is_bounded_and_ordered_by_commit_then_identity() {
    let (_directory, database, resolver) = fixture().await;
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_transitionoccurrence (
                occurrence_id, version, issue_id, project_id, issue_type_id,
                from_state_id, to_state_id, from_group, to_group,
                work_item_revision, workflow_revision, destination_auto_start, committed_at
            ) VALUES
                ('ffffffffffffffffffffffffffffffff', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                 '{STATE}', '{STATE}', 'started', 'started', 3, 17, 1, '2026-01-02 00:00:00'),
                ('22222222222222222222222222222222', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                 '{STATE}', '{STATE}', 'started', 'started', 2, 17, 1, '2026-01-01 00:00:00'),
                ('11111111111111111111111111111111', 1, '{TASK}', '{PROJECT}', '{TYPE}',
                 '{STATE}', '{STATE}', 'started', 'started', 1, 17, 1, '2026-01-01 00:00:00');
            "#
        ))
        .await
        .unwrap();

    let first = launch_policy::prepare_pending_auto_starts(&database, &resolver, 2)
        .await
        .unwrap();
    assert_eq!(
        first
            .iter()
            .map(|decision| decision.idempotency_key.as_str())
            .collect::<Vec<_>>(),
        [
            "11111111111111111111111111111111",
            "22222222222222222222222222222222"
        ]
    );
    let second = launch_policy::prepare_pending_auto_starts(&database, &resolver, 2)
        .await
        .unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(
        second[0].idempotency_key,
        "ffffffffffffffffffffffffffffffff"
    );
}

/// The retry command only appends a pending child; the launch it is still owed
/// is a policy decision. That decision must be minted exactly once per retry
/// attempt, must carry the attempt as its idempotency key, and must never be
/// minted for a root attempt the auto-start door already owns.
#[tokio::test]
async fn a_pending_retry_child_becomes_exactly_one_launch_decision() {
    let (_directory, database, resolver) = fixture().await;
    seed_attempts(&database).await;

    let decisions = launch_policy::prepare_pending_retries(&database, &resolver, 10)
        .await
        .unwrap();

    assert_eq!(decisions.len(), 1);
    assert_eq!(decisions[0].caller_scope, CallerScope::Retry);
    assert_eq!(decisions[0].idempotency_key, RETRY_ATTEMPT);
    assert_eq!(
        decisions[0].state_id,
        uuid::Uuid::parse_str(STATE).unwrap().to_string()
    );
    assert_eq!(decisions[0].prompt, "Implement it.");

    // A second pass owes nothing: the recorded decision is what makes the
    // retry launch exactly once, however often the reconciler runs.
    assert!(
        launch_policy::prepare_pending_retries(&database, &resolver, 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        launch_policy::pending(&database, 10).await.unwrap().len(),
        1
    );
}

/// A retry whose configuration is broken is diagnosed, not retired: repairing
/// the configuration re-queues the retry the user already asked for.
#[tokio::test]
async fn a_rejected_retry_is_re_resolved_once_its_configuration_is_repaired() {
    let (_directory, database, resolver) = fixture().await;
    seed_attempts(&database).await;
    database
        .execute_unprepared("UPDATE worktracker_launchbinding SET prompt = ''")
        .await
        .unwrap();

    assert!(
        launch_policy::prepare_pending_retries(&database, &resolver, 10)
            .await
            .unwrap()
            .is_empty()
    );

    database
        .execute_unprepared(
            r#"
            UPDATE worktracker_launchbinding SET prompt = 'Implement it.';
            UPDATE ticketry_launchpolicyrejection
                SET rejected_at = datetime('now', '-1 hour');
            "#,
        )
        .await
        .unwrap();
    let recovered = launch_policy::prepare_pending_retries(&database, &resolver, 10)
        .await
        .unwrap();

    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].idempotency_key, RETRY_ATTEMPT);
}

const ROOT_ATTEMPT: &str = "a0000000000000000000000000000001";
const RETRY_ATTEMPT: &str = "a0000000000000000000000000000002";
const PENDING_ROOT_ATTEMPT: &str = "a0000000000000000000000000000003";

/// A failed root with the pending retry child the retry command appends, plus
/// an unrelated pending root the auto-start door owns.
async fn seed_attempts(database: &DatabaseConnection) {
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO automation_attempts (
                id, transition_id, issue_id, from_state_id, to_state_id,
                workflow_revision, status, retryable, retry_of_id, root_attempt_id,
                created_at, updated_at
            ) VALUES
                ('{ROOT_ATTEMPT}', 'cccccccccccccccccccccccccccccccc', '{TASK}',
                 '{STATE}', '{STATE}', 17, 'failed', 1, NULL, NULL,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{RETRY_ATTEMPT}', 'cccccccccccccccccccccccccccccccc', '{TASK}',
                 '{STATE}', '{STATE}', 17, 'pending', 1, '{ROOT_ATTEMPT}', '{ROOT_ATTEMPT}',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{PENDING_ROOT_ATTEMPT}', 'dddddddddddddddddddddddddddddddd', '{TASK}',
                 '{STATE}', '{STATE}', 17, 'pending', 1, NULL, NULL,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
}

async fn store_catalog(database: &DatabaseConnection, value: &str) {
    database
        .execute_unprepared(&format!(
            r#"UPDATE app_settings SET value = '{value}' WHERE scope = 'host' AND "key" = 'provider_catalog'"#
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn resolution_reads_the_stored_default_exactly_as_the_catalogue_query_does() {
    let (_directory, database, resolver) = fixture().await;

    // A default carrying a key this build does not understand is no default at
    // all — the resolver must not silently launch on the provider it names.
    store_catalog(
        &database,
        r#"{"global_default":{"provider":"codex","future":true}}"#,
    )
    .await;
    assert_eq!(
        resolver
            .resolve(request(CallerScope::Interactive, "unknown-key"))
            .await
            .unwrap_err()
            .code(),
        "agent_not_configured"
    );

    // An un-normalized provider slug is trimmed before lookup, so the resolver
    // agrees with the catalogue query instead of rejecting every launch.
    store_catalog(&database, r#"{"global_default":{"provider":" codex "}}"#).await;
    let decision = resolver
        .resolve(request(CallerScope::Interactive, "untrimmed"))
        .await
        .unwrap();
    assert_eq!(
        (decision.provider.as_str(), decision.model.as_deref()),
        ("codex", None)
    );
}
