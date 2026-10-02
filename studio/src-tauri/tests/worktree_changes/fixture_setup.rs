use super::*;

pub(super) async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create changes fixture directory");
    let state = directory.path().join("state.db");
    let repository_root = directory.path().join("repositories/ticketry");
    let checkout = directory.path().join("checkouts/CODIN-881-task");
    let base_commit = repository(&repository_root);
    git(
        &[
            "worktree",
            "add",
            "-b",
            "wt/CODIN-881-task",
            &checkout.display().to_string(),
            &base_commit,
        ],
        &repository_root,
    );

    let writer = Database::connect(format!("sqlite:{}?mode=rwc", state.display()))
        .await
        .expect("open the fixture writer");
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
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
            CREATE TABLE worktrees (
                id VARCHAR NOT NULL PRIMARY KEY, task_id VARCHAR NOT NULL UNIQUE,
                workspace_slug VARCHAR, project_id VARCHAR, module_id VARCHAR,
                ticket_seq INTEGER, repo_root VARCHAR NOT NULL, path VARCHAR NOT NULL,
                branch VARCHAR NOT NULL, base_branch VARCHAR NOT NULL,
                base_commit VARCHAR NOT NULL, status VARCHAR NOT NULL,
                ephemeral BOOLEAN NOT NULL, created_at VARCHAR NOT NULL,
                updated_at VARCHAR NOT NULL
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', 'Coding', 'CODIN', '', 900, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{TASK_TYPE}', '{PROJECT}', 'Story', 'task', '', 0, '{BACKLOG}', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{MODULE_TYPE}', '{PROJECT}', 'Module', 'module', '', 1, NULL, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Ticketry', 880, 0, 'y', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Task', 881, 0, 'z', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktrees VALUES (
                '70000000000000000000000000000001', '{TASK}', 'meml', '{PROJECT}',
                '{MODULE}', 881, '{repository}', '{checkout}', 'wt/CODIN-881-task',
                'main', '{base_commit}', 'active', 0,
                '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00'
            );
            "#,
            repository = repository_root.display(),
            checkout = checkout.display(),
        ))
        .await
        .expect("create worktree changes fixture");
    link_module(&writer, &repository_root).await;
    drop(writer);

    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state,
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("compose the worktree changes schema");

    let writer = Database::connect(format!("sqlite:{}?mode=rw", state.display()))
        .await
        .expect("reopen fixture writer");
    let intent = serde_json::json!({
        "kind": "worktree_create",
        "intentVersion": 2,
        "payload": {
            "taskId": TASK,
            "branch": "wt/CODIN-881-task",
            "checkoutName": "CODIN-881-task",
            "repositoryDigest": "a".repeat(64),
            "baseRef": "main",
            "baseCommit": base_commit.clone(),
        }
    })
    .to_string();
    let evidence = serde_json::json!({
        "worktreeId": "70000000000000000000000000000001",
        "adopted": false,
        "branch": "wt/CODIN-881-task",
        "baseRef": "main",
        "baseCommit": base_commit.clone(),
        "checkoutName": "CODIN-881-task",
    })
    .to_string();
    let result = serde_json::json!({
        "worktreeId": "70000000000000000000000000000001",
        "taskId": TASK,
        "branch": "wt/CODIN-881-task",
        "checkoutName": "CODIN-881-task",
        "baseRef": "main",
        "baseCommit": base_commit.clone(),
        "adopted": false,
    })
    .to_string();
    writer
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO workspace_operations
             (operation_id, kind, intent_version, resource_kind, resource_key, intent,
              intent_fingerprint, state, attempt_count, evidence, result_summary,
              created_at, updated_at, settled_at)
             VALUES (?, 'worktree_create', 2, 'worktree', ?, ?, ?, 'applied', 1, ?, ?,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [
                "80000000000000000000000000000001".into(),
                format!("worktree/{TASK}").into(),
                intent.into(),
                "b".repeat(64).into(),
                evidence.into(),
                result.into(),
            ],
        ))
        .await
        .expect("record durable creation provenance");
    drop(writer);

    Fixture {
        _directory: directory,
        api,
        checkout,
        base_commit,
    }
}
