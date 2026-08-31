//! Live worktree status over real Git, through the composed GraphQL schema.
//!
//! Every assertion enters where Studio does — one Work Item identity into
//! `worktree_status` — and is checked against the actual repository on disk
//! rather than against the row. The row is deliberately left saying `active`
//! in the divergence and conflict cases so a stale column cannot pass.

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
const OTHER_MODULE: &str = "20000000000000000000000000000002";
const PARENT_TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";
const UNLINKED_TASK: &str = "60000000000000000000000000000003";

const STATUS_QUERY: &str = r#"query($taskId: String!) {
  worktree_status(task_id: $taskId) {
    kind
    task_id
    top_level_task_id
    is_shared
    branch
    base_branch
    path
    state
    clean
    dirty
    ahead
    behind
    conflict
    checkout_present
    ephemeral
    reason
  }
}"#;

// ---------------------------------------------------------------------------
// Git fixtures — real repositories, no simulation
// ---------------------------------------------------------------------------

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

/// A repository on `main` with one commit.
fn repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    write(&root.join("README.md"), "base\n");
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);
    git(&["rev-parse", "HEAD"], root)
}

/// A checkout for a task branch cut from the repository's committed HEAD.
fn checkout(repository_root: &Path, path: &Path, branch: &str, base_commit: &str) {
    git(
        &[
            "worktree",
            "add",
            "-b",
            branch,
            &path.display().to_string(),
            base_commit,
        ],
        repository_root,
    );
}

// ---------------------------------------------------------------------------
// Ticketry fixtures
// ---------------------------------------------------------------------------

/// Point the fixture module at one local folder, through the one write seam.
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
    directory: tempfile::TempDir,
    api: TransportApiImpl,
    repository_root: PathBuf,
    base_commit: String,
}

impl Fixture {
    fn checkout_path(&self) -> PathBuf {
        self.directory.path().join("checkouts/CODIN-881-parent")
    }

    async fn status(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({
                    "query": STATUS_QUERY,
                    "variables": { "taskId": task_id },
                })
                .to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode the worktree status response")
    }

    async fn worktree(&self, task_id: &str) -> serde_json::Value {
        let response = self.status(task_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null);
        response["data"]["worktree_status"].clone()
    }
}

/// A data directory holding the adopted schema, one module linked to a real
/// repository, and one module linked to nothing.
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create worktree status fixture directory");
    let state = directory.path().join("state.db");
    let repository_root = directory.path().join("repositories/ticketry");
    let base_commit = repository(&repository_root);

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
                workspace_tab_order JSON NOT NULL DEFAULT '[]',
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
                updated_at VARCHAR NOT NULL, pull_request_url VARCHAR
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
                ('{OTHER_MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Unlinked', 879, 0, 'y', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{PARENT_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Parent story', 881, 0, 'z', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{PARENT_TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{UNLINKED_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{OTHER_MODULE}',
                 '{OTHER_MODULE}', '{BACKLOG}', 1, 'Unlinked story', 883, 0, 'zb', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the worktree status fixture");
    // A module's repository is its typed link, so a status read resolves it
    // from the installation rather than from whichever profile is selected.
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
    .expect("compose the worktree status schema");

    Fixture {
        directory,
        api,
        repository_root,
        base_commit,
    }
}

/// Index the parent story's checkout exactly as creation will.
async fn index_worktree(fixture: &Fixture, status: &str) {
    let path = fixture.checkout_path();
    checkout(
        &fixture.repository_root,
        &path,
        "wt/CODIN-881-parent-story",
        &fixture.base_commit,
    );
    let writer = Database::connect(format!(
        "sqlite:{}?mode=rw",
        fixture.directory.path().join("state.db").display()
    ))
    .await
    .expect("open the worktree index writer");
    writer
        .execute_unprepared(&format!(
            r#"INSERT INTO worktrees VALUES (
                '70000000000000000000000000000001', '{PARENT_TASK}', 'meml', '{PROJECT}',
                '{MODULE}', 881, '{repository}', '{path}', 'wt/CODIN-881-parent-story',
                'main', '{base}', '{status}', 0,
                '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00', NULL
            );"#,
            repository = fixture.repository_root.display(),
            path = path.display(),
            base = fixture.base_commit,
        ))
        .await
        .expect("index the parent story's checkout");
}

// ---------------------------------------------------------------------------
// 1. Absence is data
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_configured_repository_without_a_checkout_offers_creation() {
    let fixture = fixture().await;

    let status = fixture.worktree(PARENT_TASK).await;

    assert_eq!(status["kind"], "none");
    assert_eq!(status["is_shared"], false);
    assert_eq!(status["branch"], serde_json::Value::Null);
    assert_eq!(status["reason"], serde_json::Value::Null);
}

#[tokio::test]
async fn a_module_with_no_configured_folder_reports_no_repository() {
    let fixture = fixture().await;

    let status = fixture.worktree(UNLINKED_TASK).await;

    assert_eq!(status["kind"], "no_repo");
    assert_eq!(status["reason"], "no local folder is linked to this module");
    assert_eq!(status["path"], serde_json::Value::Null);
}

#[tokio::test]
async fn a_linked_folder_outside_git_reports_no_repository() {
    let fixture = fixture().await;
    let plain = fixture.directory.path().join("plain-folder");
    std::fs::create_dir_all(&plain).expect("create a non-repository folder");
    let writer = Database::connect(format!(
        "sqlite:{}?mode=rw",
        fixture.directory.path().join("state.db").display()
    ))
    .await
    .expect("open the fixture writer");
    link_module(&writer, &plain).await;
    drop(writer);

    let status = fixture.worktree(PARENT_TASK).await;

    assert_eq!(status["kind"], "no_repo");
    assert_eq!(
        status["reason"],
        "no git repository encloses this module folder"
    );
}

// ---------------------------------------------------------------------------
// 2. Ownership is derived
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_child_work_item_shares_its_top_level_parents_checkout() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;

    let parent = fixture.worktree(PARENT_TASK).await;
    let child = fixture.worktree(CHILD_TASK).await;

    assert_eq!(child["kind"], "worktree");
    assert_eq!(child["is_shared"], true);
    assert_eq!(child["task_id"], "60000000-0000-0000-0000-000000000002");
    assert_eq!(
        child["top_level_task_id"],
        "60000000-0000-0000-0000-000000000001"
    );
    assert_eq!(child["branch"], parent["branch"]);
    assert_eq!(child["path"], parent["path"]);
    assert_eq!(parent["is_shared"], false);
}

#[tokio::test]
async fn a_module_can_never_own_a_worktree() {
    let fixture = fixture().await;

    let response = fixture.status(MODULE).await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "worktree_work_item_invalid"
    );
}

#[tokio::test]
async fn an_unknown_work_item_is_a_typed_failure_rather_than_an_empty_status() {
    let fixture = fixture().await;

    let response = fixture.status("60000000-0000-0000-0000-00000000dead").await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"],
        "worktree_work_item_not_found"
    );
}

// ---------------------------------------------------------------------------
// 3. Live facts come from Git, not from the row
// ---------------------------------------------------------------------------

#[tokio::test]
async fn clean_dirty_and_divergence_are_read_from_the_checkout() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;
    let path = fixture.checkout_path();

    let clean = fixture.worktree(PARENT_TASK).await;
    assert_eq!(clean["clean"], true);
    assert_eq!(clean["dirty"], false);
    assert_eq!(clean["ahead"], 0);
    assert_eq!(clean["behind"], 0);
    assert_eq!(clean["checkout_present"], true);
    assert_eq!(clean["state"], "active");
    assert_eq!(clean["base_branch"], "main");

    write(&path.join("feature.md"), "work in progress\n");
    let dirty = fixture.worktree(PARENT_TASK).await;
    assert_eq!(dirty["dirty"], true);
    assert_eq!(dirty["clean"], false);

    git(&["add", "."], &path);
    git(&["commit", "-m", "task work"], &path);
    write(&fixture.repository_root.join("base.md"), "moved on\n");
    git(&["add", "."], &fixture.repository_root);
    git(&["commit", "-m", "base work"], &fixture.repository_root);

    let diverged = fixture.worktree(PARENT_TASK).await;
    assert_eq!(diverged["ahead"], 1);
    assert_eq!(diverged["behind"], 1);
    assert_eq!(diverged["clean"], true);
    assert_eq!(diverged["conflict"], false);
}

#[tokio::test]
async fn an_unmerged_checkout_reports_conflict_even_while_the_row_says_active() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;
    let path = fixture.checkout_path();

    write(&path.join("README.md"), "task edit\n");
    git(&["commit", "-am", "task edit"], &path);
    write(&fixture.repository_root.join("README.md"), "base edit\n");
    git(&["commit", "-am", "base edit"], &fixture.repository_root);
    // The merge stops inside the isolated checkout; the primary is untouched.
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["merge", "--no-edit", "main"])
        .output()
        .expect("attempt the conflicting merge");

    let status = fixture.worktree(PARENT_TASK).await;

    assert_eq!(status["conflict"], true);
    assert_eq!(status["state"], "conflict");
    assert_eq!(status["checkout_present"], true);
}

#[tokio::test]
async fn a_durable_conflict_state_survives_a_settled_looking_checkout() {
    let fixture = fixture().await;
    index_worktree(&fixture, "conflict").await;

    let status = fixture.worktree(PARENT_TASK).await;

    assert_eq!(status["conflict"], true);
    assert_eq!(status["state"], "conflict");
    assert_eq!(status["dirty"], false);
}

#[tokio::test]
async fn a_removed_checkout_reports_absence_without_inventing_clean_state() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;
    std::fs::remove_dir_all(fixture.checkout_path()).expect("remove the checkout");

    let status = fixture.worktree(PARENT_TASK).await;

    assert_eq!(status["kind"], "worktree");
    assert_eq!(status["checkout_present"], false);
    assert_eq!(status["clean"], false);
    assert_eq!(status["dirty"], false);
    assert_eq!(status["ahead"], 0);
    assert_eq!(status["behind"], 0);
    // The index is still the persistence fact: the branch and path remain.
    assert_eq!(status["branch"], "wt/CODIN-881-parent-story");
}

#[tokio::test]
async fn an_indexed_checkout_is_reattached_after_the_database_is_reopened() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;
    let before = fixture.worktree(PARENT_TASK).await;

    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &fixture.directory.path().join("rust-core-restart.sqlite3"),
        &fixture.directory.path().join("state.db"),
        &fixture.directory.path().join("media"),
        &api,
    )
    .await
    .expect("recompose the schema over the same data directory");
    let restarted = Fixture { api, ..fixture };

    assert_eq!(restarted.worktree(PARENT_TASK).await, before);
}

// ---------------------------------------------------------------------------
// 4. Repositories do not block each other
// ---------------------------------------------------------------------------

#[tokio::test]
async fn concurrent_reads_of_one_repository_agree_and_do_not_block_another() {
    let fixture = fixture().await;
    index_worktree(&fixture, "active").await;

    let (parent, child, unlinked) = tokio::join!(
        fixture.worktree(PARENT_TASK),
        fixture.worktree(CHILD_TASK),
        fixture.worktree(UNLINKED_TASK),
    );

    assert_eq!(parent["path"], child["path"]);
    assert_eq!(parent["clean"], child["clean"]);
    assert_eq!(unlinked["kind"], "no_repo");
}
