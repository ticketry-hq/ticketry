use sea_orm::{ConnectionTrait, Database};

pub async fn prepare_command_database(directory: &tempfile::TempDir) {
    let path = directory.path().join("state.db");
    let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open MCP command fixture");
    database
        .execute_unprepared(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
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
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(project_id, sequence_id),
                FOREIGN KEY(parent_id) REFERENCES worktracker_issue(id) ON DELETE SET NULL
            );
            CREATE TABLE worktracker_issue_blocked_by (
                id integer PRIMARY KEY, from_issue_id char(32) NOT NULL,
                to_issue_id char(32) NOT NULL
            );
            CREATE TABLE worktracker_label (
                id char(32) PRIMARY KEY, project_id char(32) NOT NULL,
                name varchar(255) NOT NULL, color varchar(32) NOT NULL DEFAULT '',
                UNIQUE(project_id, name)
            );
            CREATE TABLE worktracker_issue_labels (
                id integer PRIMARY KEY AUTOINCREMENT,
                issue_id char(32) NOT NULL, label_id char(32) NOT NULL,
                UNIQUE(issue_id, label_id),
                FOREIGN KEY(issue_id) REFERENCES worktracker_issue(id) ON DELETE CASCADE,
                FOREIGN KEY(label_id) REFERENCES worktracker_label(id) ON DELETE CASCADE
            );
            CREATE TABLE worktracker_attachment (
                id char(32) PRIMARY KEY, issue_id char(32) NOT NULL,
                file varchar(100) NOT NULL, filename varchar(512) NOT NULL,
                mime_type varchar(255) NOT NULL, size integer,
                created_at datetime NOT NULL
            );
            CREATE TABLE worktracker_provider (
                id char(32) PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE,
                activated bool NOT NULL, supports_unattended bool NOT NULL
            );
            CREATE TABLE app_settings (
                scope varchar NOT NULL, "key" varchar NOT NULL,
                value varchar NOT NULL, updated_at varchar NOT NULL,
                PRIMARY KEY(scope, "key")
            );
            CREATE TABLE worktracker_issuetypetransition (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                from_state_id char(32) NOT NULL, to_state_id char(32) NOT NULL,
                agent_allowed bool NOT NULL, handoff bool NOT NULL DEFAULT 0,
                UNIQUE(issue_type_id, from_state_id, to_state_id)
            );
            CREATE TABLE module_links (
                id char(32) PRIMARY KEY, module_id char(32) NOT NULL UNIQUE,
                path text NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL
            );
            CREATE TABLE worktrees (
                id char(32) PRIMARY KEY, task_id char(32) NOT NULL,
                workspace_slug char(32), project_id char(32), module_id char(32),
                ticket_seq integer, repo_root text NOT NULL, path text NOT NULL,
                branch text NOT NULL, base_branch text NOT NULL, base_commit text NOT NULL,
                status varchar(32) NOT NULL, ephemeral bool NOT NULL,
                created_at varchar(64) NOT NULL, updated_at varchar(64) NOT NULL,
                pull_request_url text
            );
            CREATE TABLE design_documents (
                id char(32) PRIMARY KEY, module_id char(32) NOT NULL,
                task_id char(32) NOT NULL, scope varchar(32) NOT NULL,
                root_dir text NOT NULL, rel_path text NOT NULL,
                discovered_by_run_id char(32), created_at varchar(64) NOT NULL,
                updated_at varchar(64) NOT NULL, content_digest text
            );
            CREATE TABLE worktracker_launchbinding (
                id integer PRIMARY KEY AUTOINCREMENT, issue_type_id char(32) NOT NULL,
                state_id char(32) NOT NULL, profile varchar(64),
                prompt text NOT NULL,
                required_skills text NOT NULL,
                stage_skills text NOT NULL DEFAULT '[]',
                model_id char(32), reasoning_id char(32),
                auto_start bool NOT NULL, subtree_run_enabled bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL,
                UNIQUE(issue_type_id, state_id)
            );
            CREATE TABLE agent_runs (
                id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER,
                agent TEXT NOT NULL, model TEXT, reasoning TEXT, status TEXT NOT NULL,
                started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, error TEXT,
                cwd TEXT, provider_session_id TEXT, lifecycle_state TEXT,
                lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
                scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT,
                initial_prompt TEXT, launch_reasoning TEXT,
                launch_unattended BOOL NOT NULL DEFAULT 0
            );
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE agent_terminal_sessions (
                agent_run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
                tmux_session_name TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
                module_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL,
                terminated_at TEXT, scope TEXT NOT NULL, doc_rel_path TEXT,
                runtime_cleanup_pending BOOL NOT NULL DEFAULT 0, runtime_namespace TEXT,
                output_identity TEXT, output_sequence INTEGER NOT NULL DEFAULT 0,
                last_output_at TEXT, agent TEXT
            );
            CREATE TABLE terminal_cleanup_effects (
                effect_id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL UNIQUE
                    REFERENCES agent_terminal_sessions(agent_run_id) ON DELETE CASCADE,
                cause TEXT NOT NULL, state TEXT NOT NULL, lease_owner TEXT,
                lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error_code TEXT, last_error_message TEXT, runtime_evidence TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, applied_at TEXT
            );
            INSERT INTO worktracker_project VALUES
                ('10000000000000000000000000000000',
                 'Authorized', 'AUTH', '', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('40000000000000000000000000000001', '10000000000000000000000000000000',
                 'Backlog', 'backlog', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('40000000000000000000000000000002', '10000000000000000000000000000000',
                 'Review', 'started', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('40000000000000000000000000000003', '10000000000000000000000000000000',
                 'Building', 'started', '', 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('40000000000000000000000000000004', '10000000000000000000000000000000',
                 'Validation', 'started', '', 3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('30000000000000000000000000000001', '10000000000000000000000000000000',
                 'Story', 'task', '', 0, '40000000000000000000000000000001', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000002', '10000000000000000000000000000000',
                 'Implementation', 'task', '', 1, '40000000000000000000000000000001', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000003', '10000000000000000000000000000000',
                 'Module', 'module', '', 2, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('20000000000000000000000000000001', '10000000000000000000000000000000',
                 'module', '30000000000000000000000000000003', NULL, NULL, NULL, 0,
                 'Module', 0, 0, 'M', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('30000000000000000000000000000000', '10000000000000000000000000000000',
                 'task', '30000000000000000000000000000002', NULL,
                 '20000000000000000000000000000001', '40000000000000000000000000000003', 0,
                 'Authenticated caller', 900, 0, 'Z', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO agent_runs
                (id, issue_id, agent, status, started_at, scope, launch_state)
                VALUES ('run-valid', '30000000000000000000000000000000', 'codex',
                        'running', '2026-08-15T00:00:00+00:00', 'task', 'Building');
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id, from_state_id, to_state_id, agent_allowed)
                VALUES ('30000000000000000000000000000002',
                        '40000000000000000000000000000003',
                        '40000000000000000000000000000004', 1);
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, auto_start,
                 subtree_run_enabled, created_at, updated_at)
                VALUES ('30000000000000000000000000000002',
                        '40000000000000000000000000000003', 'Continue the task.', '[]', 0, 0,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                       ('30000000000000000000000000000002',
                        '40000000000000000000000000000004', 'Continue the task.', '[]', 0, 0,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO agent_terminal_sessions
                (agent_run_id, tmux_session_name, task_id, module_id, project_id,
                 created_at, scope, runtime_namespace, agent)
                VALUES ('run-valid', 'pt-run-valid',
                        '30000000000000000000000000000000',
                        '20000000000000000000000000000001',
                        '10000000000000000000000000000000',
                        '2026-08-15T00:00:00+00:00', 'task', 'fixture-runtime', 'codex');
            INSERT INTO worktracker_provider VALUES
                ('50000000000000000000000000000001', 'codex', 1, 1),
                ('50000000000000000000000000000002', 'disabled', 0, 1);
            INSERT INTO app_settings VALUES
                ('host', 'provider_catalog',
                 '{"global_default":{"provider":"codex","model":null,"reasoning":null}}',
                 CURRENT_TIMESTAMP);
            "#,
        )
        .await
        .expect("create MCP command fixture");
    let module_link_path = directory.path().to_string_lossy().replace("'", "''");
    database
        .execute_unprepared(&format!(
            "INSERT INTO module_links VALUES
                ('60000000000000000000000000000001',
                 '20000000000000000000000000000001', '{module_link_path}',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        .await
        .expect("link fixture module to the temp directory");
    ticketry_work_management::module_presentation_migration::install(&database)
        .await
        .expect("install final module-presentation shape");
    database.close().await.expect("close MCP command fixture");
}
