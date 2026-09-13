//! The one seeded installation the launch integration tests resolve against:
//! a project, an Implementation binding, a linked module, the provider
//! catalog, and a model-based global launch default.

use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use ticketry_launch::{CreateTerminalSession, LaunchAuthorityService, TerminalLaunchKind};
use ticketry_work_management::open_for_commands;

pub(crate) const PROJECT: &str = "20000000000000000000000000000000";
pub(crate) const TYPE: &str = "30000000000000000000000000000000";
pub(crate) const STATE: &str = "40000000000000000000000000000000";
pub(crate) const MODULE: &str = "50000000000000000000000000000000";
pub(crate) const TASK: &str = "60000000000000000000000000000000";
pub(crate) const DOCUMENT: &str = "65000000000000000000000000000000";
pub(crate) const CODEX: &str = "70000000000000000000000000000000";
pub(crate) const CLAUDE: &str = "70000000000000000000000000000001";
pub(crate) const DORMANT: &str = "70000000000000000000000000000002";
pub(crate) const GPT: &str = "80000000000000000000000000000000";
pub(crate) const HIGH: &str = "90000000000000000000000000000000";

pub(crate) struct Fixture {
    _directory: tempfile::TempDir,
    pub(crate) authority: LaunchAuthorityService,
    pub(crate) database: DatabaseConnection,
    pub(crate) folder: String,
}

pub(crate) async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let writer: DatabaseConnection =
        Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .unwrap();
    let folder = directory.path().display().to_string();
    writer
        .execute_unprepared(&format!(
            r#"
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
                entry_skill varchar(128), profile varchar(128),
                model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            CREATE TABLE worktrees (
                id text PRIMARY KEY, task_id text NOT NULL, workspace_slug text,
                project_id text, module_id text, ticket_seq integer,
                repo_root text NOT NULL, path text NOT NULL, branch text NOT NULL,
                base_branch text NOT NULL, base_commit text NOT NULL,
                status text NOT NULL, ephemeral bool NOT NULL,
                created_at text NOT NULL, updated_at text NOT NULL,
                pull_request_url varchar
            );
            CREATE TABLE design_documents (
                id text PRIMARY KEY, module_id text NOT NULL, task_id text NOT NULL,
                scope text NOT NULL, root_dir text NOT NULL, rel_path text NOT NULL,
                discovered_by_run_id text, created_at text NOT NULL,
                updated_at text NOT NULL, content_digest text
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Main', 'MAIN', '', 2, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{STATE}', '{PROJECT}', 'Implement', 'started', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{TYPE}', '{PROJECT}', 'Implementation', 'task', '', 0, '{STATE}', 17, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{TYPE}', NULL, NULL, NULL, 0,
                 'Terminal', 1, 0, 'M', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{TYPE}', '{MODULE}', '{MODULE}', '{STATE}', 0,
                 'Resolve launch policy', 965, 0, 'N', '<p>First</p><ul><li>Second</li></ul>',
                 '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_provider VALUES
                ('{CODEX}', 'codex', 1, 1),
                ('{CLAUDE}', 'claude', 1, 1),
                ('{DORMANT}', 'gemini', 0, 1);
            INSERT INTO worktracker_agentmodel VALUES ('{GPT}', '{CODEX}', 'gpt-5.6');
            INSERT INTO worktracker_reasoninglevel VALUES ('{HIGH}', 'high');
            INSERT INTO worktracker_agentmodelreasoninglevel
                (agent_model_id, reasoning_level_id) VALUES ('{GPT}', '{HIGH}');
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, profile, model_id,
                 reasoning_id, auto_start, subtree_run_enabled, created_at, updated_at)
                VALUES ('{TYPE}', '{STATE}', 'Only this child''s agreed slice.', '["tdd"]',
                        NULL, NULL, NULL, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO design_documents VALUES
                ('{DOCUMENT}', '{MODULE}', '{TASK}', 'task', '{folder}', 'T965--launch/HLD.html',
                 NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
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
        r#"{"recent_profile_index":0,"profiles":[{"name":"Local","workspace_slug":"meml"}]}"#,
    )
    .unwrap();
    let database = open_for_commands(&path).await.unwrap();
    // The folder a launch runs in is the module's typed link, not a profile
    // entry, so the prompt facts and the design directory resolve from here.
    ticketry_work_management::schema::install(&database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &folder)
        .await
        .expect("link the fixture module");
    let authority = LaunchAuthorityService::new(database.clone());
    Fixture {
        _directory: directory,
        authority,
        database,
        folder,
    }
}

/// A request shaped exactly like one a client can submit, with every
/// policy-owned field filled in with something the caller must not get.
pub(crate) fn caller_request(kind: TerminalLaunchKind) -> CreateTerminalSession {
    let issue_id = match kind {
        TerminalLaunchKind::Planning | TerminalLaunchKind::Instant => MODULE,
        _ => TASK,
    };
    CreateTerminalSession {
        client_request_id: "launch-request".to_owned(),
        project_id: PROJECT.to_owned(),
        issue_id: issue_id.to_owned(),
        module_id: MODULE.to_owned(),
        target_id: issue_id.to_owned(),
        kind,
        provider: Some("codex".to_owned()),
        profile: None,
        model: Some("caller-chosen-model".to_owned()),
        reasoning: Some("caller-chosen-reasoning".to_owned()),
        policy_reference: Some("caller-chosen-policy".to_owned()),
        prompt: Some("caller text".to_owned()),
        resume_from_agent_run_id: None,
        automation_attempt_id: None,
        required_skills: vec!["caller-chosen-skill".to_owned()],
        working_directory_identity: format!("task:{issue_id}"),
        design_directory_identity: Some("caller-chosen-directory".to_owned()),
        document_relative_path: Some("caller-chosen.html".to_owned()),
        columns: 120,
        rows: 40,
    }
}
