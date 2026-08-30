//! Cumulative task-worktree changes through the public GraphQL query.

use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tauri_graphql::{TransportApi, TransportApiImpl};

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
const TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";

const CHANGES_QUERY: &str = r#"query($taskId: String!) {
  worktree_changes(task_id: $taskId) {
    task_id
    top_level_task_id
    is_shared
    base_commit
    truncated
    files {
      path
      previous_path
      status
    }
  }
}"#;

const STATUS_AND_CHANGES_QUERY: &str = r#"query($taskId: String!) {
  worktree_status(task_id: $taskId) { dirty }
  worktree_changes(task_id: $taskId) {
    files { path previous_path status }
  }
}"#;

const MODULE_VERSION_CONTROL_QUERY: &str = r#"query($moduleId: String!) {
  module_version_control(module_id: $moduleId) {
    module_id
    checkout { available branch baseline baseline_kind clean dirty unpushed_count files { path status } }
    worktrees_truncated
    worktrees {
      kind task_id task_key task_name branch available clean dirty
      unpushed_count pull_request_state reason
    }
  }
}"#;

fn git(arguments: &[&str], working_directory: &Path) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Ticketry Test")
        .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
        .env("GIT_COMMITTER_NAME", "Ticketry Test")
        .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        arguments,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent directory");
    }
    std::fs::write(path, contents).expect("write fixture file");
}

fn repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    write(&root.join("README.md"), "base\n");
    write(&root.join("src/unstaged.rs"), "pub fn before() {}\n");
    write(&root.join("deleted.txt"), "delete me\n");
    write(
        &root.join("rename-old.txt"),
        "rename me with enough content\n",
    );
    write(
        &root.join("copy-source.txt"),
        "copy me with enough unique content for detection\n",
    );
    write(&root.join("conflict.txt"), "common base\n");
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);
    git(&["rev-parse", "HEAD"], root)
}

async fn link_module(database: &DatabaseConnection, folder: &Path) {
    muxed_studio_lib::module_links::schema::install(database)
        .await
        .expect("install the Module Link schema");
    muxed_studio_lib::module_links::ModuleLinkStore::new(database.clone())
        .set(MODULE, &folder.display().to_string())
        .await
        .expect("link the fixture module");
}

struct Fixture {
    _directory: tempfile::TempDir,
    api: TransportApiImpl,
    checkout: PathBuf,
    base_commit: String,
}

impl Fixture {
    async fn response(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": CHANGES_QUERY,
                    "variables": { "taskId": task_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode worktree changes response")
    }

    async fn changes(&self, task_id: &str) -> serde_json::Value {
        let response = self.response(task_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_changes"].clone()
    }

    async fn status_and_changes(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": STATUS_AND_CHANGES_QUERY,
                    "variables": { "taskId": task_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode status and changes response")
    }

    async fn module_version_control(&self) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": MODULE_VERSION_CONTROL_QUERY,
                    "variables": { "moduleId": MODULE },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode module version-control response")
    }

    async fn execute(&self, statement: &str) {
        let database = Database::connect(format!(
            "sqlite:{}?mode=rw",
            self._directory.path().join("state.db").display()
        ))
        .await
        .expect("open fixture database");
        database
            .execute_unprepared(statement)
            .await
            .expect("mutate fixture state");
    }
}

fn error_code(response: &serde_json::Value) -> &str {
    response["errors"][0]["extensions"]["code"]
        .as_str()
        .expect("structured GraphQL error code")
}

async fn fixture() -> Fixture {
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

    Fixture {
        _directory: directory,
        api,
        checkout,
        base_commit,
    }
}

#[tokio::test]
async fn committed_task_changes_remain_visible_in_a_clean_checkout() {
    let fixture = fixture().await;
    write(
        &fixture.checkout.join("src/committed.rs"),
        "pub fn task_work() {}\n",
    );
    git(&["add", "."], &fixture.checkout);
    let before = fixture.status_and_changes(TASK).await;
    assert_eq!(before["errors"], serde_json::Value::Null, "{before}");
    assert_eq!(before["data"]["worktree_status"]["dirty"], true);

    git(&["commit", "-m", "task work"], &fixture.checkout);

    let after = fixture.status_and_changes(TASK).await;
    assert_eq!(after["errors"], serde_json::Value::Null, "{after}");
    assert_eq!(after["data"]["worktree_status"]["dirty"], false);
    assert_eq!(
        after["data"]["worktree_changes"]["files"],
        before["data"]["worktree_changes"]["files"]
    );
    let changes = fixture.changes(TASK).await;

    assert_eq!(changes["base_commit"], fixture.base_commit);
    assert_eq!(changes["truncated"], false);
    assert_eq!(
        changes["files"],
        serde_json::json!([{
            "path": "src/committed.rs",
            "previous_path": null,
            "status": "added"
        }])
    );
}

#[tokio::test]
async fn recorded_base_remains_stable_when_the_base_branch_advances() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("task-only.txt"), "task work\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "task work"], &fixture.checkout);
    let before = fixture.changes(TASK).await;

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("base-advanced.txt"), "new base work\n");
    git(&["add", "."], &primary);
    git(&["commit", "-m", "advance base branch"], &primary);

    let after = fixture.changes(TASK).await;
    assert_eq!(after["base_commit"], fixture.base_commit);
    assert_eq!(after["files"], before["files"]);
    assert_eq!(after["files"].as_array().unwrap().len(), 1);
    assert_eq!(after["files"][0]["path"], "task-only.txt");
}

#[tokio::test]
async fn committed_index_worktree_untracked_and_conflicted_paths_form_one_net_list() {
    let fixture = fixture().await;

    write(&fixture.checkout.join("src/committed.rs"), "committed\n");
    write(&fixture.checkout.join("conflict.txt"), "task side\n");
    git(&["add", "."], &fixture.checkout);
    git(&["commit", "-m", "committed task work"], &fixture.checkout);

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("conflict.txt"), "base side\n");
    git(&["commit", "-am", "base conflict"], &primary);
    let merge = Command::new("git")
        .arg("-C")
        .arg(&fixture.checkout)
        .args(["merge", "--no-edit", "main"])
        .output()
        .expect("attempt conflicting merge");
    assert!(!merge.status.success(), "the fixture merge must conflict");

    write(&fixture.checkout.join("src/staged.rs"), "staged\n");
    git(&["add", "src/staged.rs"], &fixture.checkout);
    write(
        &fixture.checkout.join("src/unstaged.rs"),
        "pub fn after() {}\n",
    );
    write(&fixture.checkout.join("src/untracked.rs"), "untracked\n");
    std::fs::remove_file(fixture.checkout.join("deleted.txt")).expect("delete tracked file");
    git(
        &["mv", "rename-old.txt", "rename-new.txt"],
        &fixture.checkout,
    );
    std::fs::copy(
        fixture.checkout.join("copy-source.txt"),
        fixture.checkout.join("copy-target.txt"),
    )
    .expect("copy tracked content");
    git(&["add", "copy-target.txt"], &fixture.checkout);

    let changes = fixture.changes(TASK).await;

    assert_eq!(
        changes["files"],
        serde_json::json!([
            {"path": "conflict.txt", "previous_path": null, "status": "conflicted"},
            {"path": "copy-target.txt", "previous_path": "copy-source.txt", "status": "copied"},
            {"path": "deleted.txt", "previous_path": null, "status": "deleted"},
            {"path": "rename-new.txt", "previous_path": "rename-old.txt", "status": "renamed"},
            {"path": "src/committed.rs", "previous_path": null, "status": "added"},
            {"path": "src/staged.rs", "previous_path": null, "status": "added"},
            {"path": "src/unstaged.rs", "previous_path": null, "status": "modified"},
            {"path": "src/untracked.rs", "previous_path": null, "status": "untracked"}
        ])
    );
}

#[tokio::test]
async fn a_child_identity_resolves_the_top_level_task_worktree() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("child.txt"), "shared checkout\n");

    let changes = fixture.changes(CHILD_TASK).await;

    assert_eq!(changes["task_id"], "60000000-0000-0000-0000-000000000002");
    assert_eq!(
        changes["top_level_task_id"],
        "60000000-0000-0000-0000-000000000001"
    );
    assert_eq!(changes["is_shared"], true);
    assert_eq!(changes["files"][0]["path"], "child.txt");
}

#[tokio::test]
async fn changed_file_output_is_sorted_bounded_and_explicitly_truncated() {
    let fixture = fixture().await;
    for index in (0..520).rev() {
        write(
            &fixture.checkout.join(format!("bulk/{index:03}.txt")),
            "untracked\n",
        );
    }

    let changes = fixture.changes(TASK).await;
    let files = changes["files"].as_array().expect("changed files");

    assert_eq!(changes["truncated"], true);
    assert_eq!(files.len(), 500);
    assert_eq!(files.first().unwrap()["path"], "bulk/000.txt");
    assert_eq!(files.last().unwrap()["path"], "bulk/499.txt");
}

#[tokio::test]
async fn a_git_byte_limit_never_returns_a_partial_nul_delimited_path() {
    let fixture = fixture().await;
    for index in 0..400 {
        write(
            &fixture
                .checkout
                .join(format!("long/{index:03}-{}.txt", "x".repeat(170))),
            "untracked\n",
        );
    }

    let changes = fixture.changes(TASK).await;
    let files = changes["files"].as_array().expect("changed files");

    assert_eq!(changes["truncated"], true);
    assert!(files.len() < 400, "the Git byte bound must be observable");
    for file in files {
        let path = file["path"].as_str().expect("complete UTF-8 path");
        assert!(
            fixture.checkout.join(path).is_file(),
            "partial path: {path}"
        );
    }
}

#[tokio::test]
async fn a_conflict_after_truncated_porcelain_keeps_its_exact_base_status() {
    let fixture = fixture().await;
    write(&fixture.checkout.join("conflict.txt"), "task side\n");
    git(&["add", "conflict.txt"], &fixture.checkout);
    git(&["commit", "-m", "task side"], &fixture.checkout);

    let primary = fixture._directory.path().join("repositories/ticketry");
    write(&primary.join("conflict.txt"), "base side\n");
    git(&["commit", "-am", "base side"], &primary);
    let merge = Command::new("git")
        .arg("-C")
        .arg(&fixture.checkout)
        .args(["merge", "--no-edit", "main"])
        .output()
        .expect("attempt conflicting merge");
    assert!(!merge.status.success(), "the fixture merge must conflict");

    for index in 0..400 {
        write(
            &fixture
                .checkout
                .join(format!("a-cancel/{index:03}-{}.txt", "x".repeat(170))),
            "cancelled add\n",
        );
    }
    git(&["add", "a-cancel"], &fixture.checkout);
    std::fs::remove_dir_all(fixture.checkout.join("a-cancel")).expect("cancel added fixture paths");

    let changes = fixture.changes(TASK).await;
    assert_eq!(changes["truncated"], true);
    let conflict = changes["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "conflict.txt")
        .expect("conflict remains in the bounded list");
    assert_eq!(conflict["status"], "conflicted");
}

#[tokio::test]
async fn missing_index_repository_checkout_and_base_have_distinct_error_codes() {
    let no_index = fixture().await;
    no_index.execute("DELETE FROM worktrees").await;
    assert_eq!(
        error_code(&no_index.response(TASK).await),
        "worktree_changes_not_found"
    );

    let missing_repository = fixture().await;
    std::fs::remove_dir_all(
        missing_repository
            ._directory
            .path()
            .join("repositories/ticketry"),
    )
    .expect("remove repository");
    assert_eq!(
        error_code(&missing_repository.response(TASK).await),
        "worktree_changes_repository_missing"
    );

    let missing_checkout = fixture().await;
    std::fs::remove_dir_all(&missing_checkout.checkout).expect("remove checkout");
    assert_eq!(
        error_code(&missing_checkout.response(TASK).await),
        "worktree_changes_checkout_missing"
    );

    let missing_base = fixture().await;
    missing_base
        .execute("UPDATE worktrees SET base_commit = '0000000000000000000000000000000000000000'")
        .await;
    assert_eq!(
        error_code(&missing_base.response(TASK).await),
        "worktree_changes_git_unavailable"
    );
}

#[tokio::test]
async fn an_invalid_recorded_path_is_a_typed_failure() {
    let recorded = fixture().await;
    recorded
        .execute("UPDATE worktrees SET path = '../outside'")
        .await;
    assert_eq!(
        error_code(&recorded.response(TASK).await),
        "worktree_changes_invalid_path"
    );
}

#[tokio::test]
async fn an_absolute_checkout_from_another_repository_is_rejected() {
    let fixture = fixture().await;
    let outside = fixture._directory.path().join("outside-repository");
    repository(&outside);
    fixture
        .execute(&format!(
            "UPDATE worktrees SET path = '{}'",
            outside.display()
        ))
        .await;

    assert_eq!(
        error_code(&fixture.response(TASK).await),
        "worktree_changes_invalid_path"
    );
}

#[tokio::test]
async fn owner_and_storage_failures_keep_their_structured_codes() {
    let fixture = fixture().await;
    assert_eq!(
        error_code(
            &fixture
                .response("60000000-0000-0000-0000-00000000dead")
                .await
        ),
        "worktree_work_item_not_found"
    );

    fixture.execute("DROP TABLE worktrees").await;
    assert_eq!(
        error_code(&fixture.response(TASK).await),
        "worktree_changes_storage_failed"
    );
}

#[tokio::test]
async fn module_list_is_read_only_current_and_ordered_from_the_checkout() {
    let fixture = fixture().await;
    let primary = fixture._directory.path().join("repositories/ticketry");
    let head_before = git(&["rev-parse", "HEAD"], &primary);
    let status_before = git(&["status", "--porcelain"], &primary);

    let response = fixture.module_version_control().await;
    assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
    let view = &response["data"]["module_version_control"];
    assert_eq!(view["checkout"]["available"], true);
    assert_eq!(view["checkout"]["clean"], true);
    assert_eq!(view["worktrees"][0]["kind"], "module");
    assert_eq!(view["worktrees"][1]["kind"], "task");
    assert_eq!(view["worktrees"][1]["task_key"], "CODIN-881");
    assert_eq!(view["worktrees"][1]["task_name"], "Task");
    assert_eq!(view["worktrees"][1]["pull_request_state"], "none");
    assert_eq!(view["worktrees_truncated"], false);

    assert_eq!(git(&["rev-parse", "HEAD"], &primary), head_before);
    assert_eq!(git(&["status", "--porcelain"], &primary), status_before);
    let repeated = fixture.module_version_control().await;
    assert_eq!(repeated["data"]["module_version_control"], *view);

    fixture
        .execute("UPDATE worktrees SET status = 'integrated'")
        .await;
    let integrated = fixture.module_version_control().await;
    assert_eq!(
        integrated["data"]["module_version_control"]["worktrees"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fixture
        .execute("UPDATE worktrees SET status = 'discarded'")
        .await;
    let discarded = fixture.module_version_control().await;
    assert_eq!(
        discarded["data"]["module_version_control"]["worktrees"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
