//! Launch characterization for the read-only compatibility boundary.
//!
//! These are the cases the still-Python terminal capability used to answer for
//! itself by reading the `worktrees` and `design_documents` tables: a
//! top-level task, a child sharing its parent's checkout, a conflict checkout,
//! a stale row whose checkout is gone, a planning run, and an instant run.
//! Each one enters through the same request shape Django posts, and is checked
//! against the real directories on disk rather than against a returned string.

use std::path::{Path, PathBuf};
use std::process::Command;

use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use ticketry_launch::{LaunchPathsErrorCode, LaunchPathsRequest, LaunchPathsService};

const WORKSPACE: &str = "90000000000000000000000000000000";
const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
const OTHER_MODULE: &str = "20000000000000000000000000000002";
const PARENT_TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";
const RUN: &str = "0f7f2b8a5d2c4c2f9d1a0b3c4d5e6f70";
const DOCUMENT: &str = "80000000000000000000000000000001";

/// The canonical design directory the fixture's parent story resolves to.
const PARENT_DESIGN_DIR: &str = "spec/ticketry--20000000/T881--parent-story";
const CHILD_DESIGN_DIR: &str = "spec/ticketry--20000000/T882--child-task";
const PLANNING_DESIGN_DIR: &str = "spec/ticketry--20000000/planning/0f7f2b8a";

// ---------------------------------------------------------------------------
// Fixtures
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

fn repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create the repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    std::fs::write(root.join("README.md"), "base\n").expect("write a base file");
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);
    git(&["rev-parse", "HEAD"], root)
}

struct Fixture {
    directory: tempfile::TempDir,
    service: LaunchPathsService,
    database: DatabaseConnection,
    repository_root: PathBuf,
    base_commit: String,
}

impl Fixture {
    fn checkout_path(&self) -> PathBuf {
        self.directory.path().join("checkouts/CODIN-881-parent")
    }

    fn module_folder(&self) -> PathBuf {
        self.repository_root.clone()
    }

    async fn resolve(&self, body: serde_json::Value) -> serde_json::Value {
        let request: LaunchPathsRequest =
            serde_json::from_value(body).expect("accept the launch path request");
        let view = self
            .service
            .resolve(request)
            .await
            .expect("resolve the launch paths");
        serde_json::to_value(view).expect("encode the launch paths")
    }

    async fn refuse(&self, body: serde_json::Value) -> LaunchPathsErrorCode {
        let request: LaunchPathsRequest =
            serde_json::from_value(body).expect("accept the launch path request");
        self.service
            .resolve(request)
            .await
            .expect_err("the boundary refuses this request")
            .code()
    }

    /// Index the parent story's checkout exactly as creation will.
    async fn index_worktree(&self, status: &str) -> PathBuf {
        let path = self.checkout_path();
        git(
            &[
                "worktree",
                "add",
                "-b",
                "wt/CODIN-881-parent-story",
                &path.display().to_string(),
                &self.base_commit,
            ],
            &self.repository_root,
        );
        self.index_worktree_row(&path, status).await;
        path
    }

    async fn index_worktree_row(&self, path: &Path, status: &str) {
        self.database
            .execute_unprepared(&format!(
                r#"INSERT INTO worktrees VALUES (
                    '70000000000000000000000000000001', '{PARENT_TASK}', 'meml', '{PROJECT}',
                    '{MODULE}', 881, '{repository}', '{path}', 'wt/CODIN-881-parent-story',
                    'main', '{base}', '{status}', 0,
                    '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00'
                );"#,
                repository = self.repository_root.display(),
                path = path.display(),
                base = self.base_commit,
            ))
            .await
            .expect("index the parent story's checkout");
    }
}

async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create the launch paths fixture directory");
    let state = directory.path().join("state.db");
    let repository_root = directory.path().join("repositories/ticketry");
    let base_commit = repository(&repository_root);

    let database = Database::connect(format!("sqlite:{}?mode=rwc", state.display()))
        .await
        .expect("open the fixture database");
    database
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
            CREATE TABLE design_documents (
                id VARCHAR NOT NULL PRIMARY KEY, module_id VARCHAR NOT NULL,
                task_id VARCHAR NOT NULL, scope VARCHAR NOT NULL,
                root_dir VARCHAR NOT NULL, rel_path VARCHAR NOT NULL,
                discovered_by_run_id VARCHAR, created_at VARCHAR NOT NULL,
                updated_at VARCHAR NOT NULL, content_digest VARCHAR
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
                 '{BACKLOG}', 1, 'Ticketry', 880, 0, 'y', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{OTHER_MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Unlinked', 879, 0, 'y', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{PARENT_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Parent story', 881, 0, 'z', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{PARENT_TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the launch paths fixture");

    // The module's folder is a typed link, so a launch resolves it from the
    // installation rather than from whichever profile happens to be selected.
    ticketry_work_management::schema::install(&database)
        .await
        .expect("install the Module Link schema");
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(MODULE, &repository_root.display().to_string())
        .await
        .expect("link the fixture module");

    let service = LaunchPathsService::new(database.clone());
    Fixture {
        directory,
        service,
        database,
        repository_root,
        base_commit,
    }
}

fn task_request(task_id: &str) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "scope": "task",
        "agent_run_id": RUN,
        "project_id": PROJECT,
        "module_id": MODULE,
        "task_id": task_id,
    })
}

fn scratch_request(scope: &str) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "scope": scope,
        "agent_run_id": RUN,
        "project_id": PROJECT,
        "module_id": MODULE,
    })
}

// ---------------------------------------------------------------------------
// 1. Task launches — use if exists
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_task_without_a_worktree_launches_in_its_module_folder() {
    let fixture = fixture().await;

    let paths = fixture.resolve(task_request(PARENT_TASK)).await;

    assert_eq!(
        paths["working_directory"],
        fixture.module_folder().display().to_string()
    );
    assert_eq!(paths["design_directory_relative"], PARENT_DESIGN_DIR);
    assert_eq!(paths["worktree"]["used"], false);
    assert_eq!(paths["worktree"]["reason"], "none");
    assert!(fixture.module_folder().join(PARENT_DESIGN_DIR).is_dir());
}

#[tokio::test]
async fn a_task_with_an_active_worktree_launches_and_writes_inside_it() {
    let fixture = fixture().await;
    let checkout = fixture.index_worktree("active").await;

    let paths = fixture.resolve(task_request(PARENT_TASK)).await;

    assert_eq!(paths["working_directory"], checkout.display().to_string());
    assert_eq!(paths["worktree"]["used"], true);
    assert_eq!(paths["worktree"]["state"], "active");
    assert_eq!(paths["worktree"]["is_shared"], false);
    // One root substitution re-homes the design directory with the run, so
    // generated documents ride the branch instead of landing in the primary
    // checkout.
    assert_eq!(
        paths["design_directory"],
        checkout.join(PARENT_DESIGN_DIR).display().to_string()
    );
    assert!(checkout.join(PARENT_DESIGN_DIR).is_dir());
    assert!(!fixture.module_folder().join(PARENT_DESIGN_DIR).is_dir());
}

#[tokio::test]
async fn a_child_shares_its_parents_checkout_and_keeps_its_own_design_directory() {
    let fixture = fixture().await;
    let checkout = fixture.index_worktree("active").await;

    let paths = fixture.resolve(task_request(CHILD_TASK)).await;

    assert_eq!(paths["working_directory"], checkout.display().to_string());
    assert_eq!(paths["worktree"]["used"], true);
    assert_eq!(paths["worktree"]["is_shared"], true);
    assert_eq!(
        paths["worktree"]["top_level_task_id"],
        "60000000-0000-0000-0000-000000000001"
    );
    // The checkout belongs to the parent; the documents belong to the child.
    assert_eq!(paths["design_directory_relative"], CHILD_DESIGN_DIR);
    assert!(checkout.join(CHILD_DESIGN_DIR).is_dir());
}

#[tokio::test]
async fn a_conflict_checkout_is_still_where_the_next_launch_runs() {
    let fixture = fixture().await;
    let checkout = fixture.index_worktree("conflict").await;

    let paths = fixture.resolve(task_request(PARENT_TASK)).await;

    // A stopped merge is resolved in place, so a conflict row is live.
    assert_eq!(paths["working_directory"], checkout.display().to_string());
    assert_eq!(paths["worktree"]["used"], true);
    assert_eq!(paths["worktree"]["state"], "conflict");
}

#[tokio::test]
async fn a_worktree_row_whose_checkout_is_gone_falls_back_to_the_module_folder() {
    let fixture = fixture().await;
    let missing = fixture.directory.path().join("checkouts/removed-by-hand");
    fixture.index_worktree_row(&missing, "active").await;

    let paths = fixture.resolve(task_request(PARENT_TASK)).await;

    assert_eq!(
        paths["working_directory"],
        fixture.module_folder().display().to_string()
    );
    assert_eq!(paths["worktree"]["used"], false);
    assert_eq!(paths["worktree"]["reason"], "checkout_missing");
    assert!(fixture.module_folder().join(PARENT_DESIGN_DIR).is_dir());
}

#[tokio::test]
async fn an_existing_renamed_design_directory_is_reused_rather_than_orphaned() {
    let fixture = fixture().await;
    let existing = fixture
        .module_folder()
        .join("spec/ticketry--20000000/T881--the-name-it-had-before");
    std::fs::create_dir_all(&existing).expect("create the existing design directory");

    let paths = fixture.resolve(task_request(PARENT_TASK)).await;

    assert_eq!(
        paths["design_directory"],
        existing.display().to_string(),
        "a renamed Work Item must keep resolving to the directory that holds its documents"
    );
}

// ---------------------------------------------------------------------------
// 2. Scratch launches — run-scoped, never a worktree
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_planning_run_keeps_its_run_scoped_design_directory() {
    let fixture = fixture().await;
    fixture.index_worktree("active").await;

    let paths = fixture.resolve(scratch_request("plan")).await;

    assert_eq!(
        paths["working_directory"],
        fixture.module_folder().display().to_string()
    );
    assert_eq!(paths["design_directory_relative"], PLANNING_DESIGN_DIR);
    assert_eq!(paths["module_directory_name"], "ticketry--20000000");
    // A scratch run is module-scoped: the parent story's checkout is not
    // consulted at all, and no worktree is minted for it.
    assert_eq!(paths["worktree"]["used"], false);
    assert_eq!(paths["worktree"]["reason"], "not_applicable");
    assert!(fixture.module_folder().join(PLANNING_DESIGN_DIR).is_dir());
}

#[tokio::test]
async fn an_instant_run_is_scoped_exactly_like_a_planning_run() {
    let fixture = fixture().await;

    let paths = fixture.resolve(scratch_request("instant")).await;

    assert_eq!(paths["design_directory_relative"], PLANNING_DESIGN_DIR);
    assert_eq!(paths["worktree"]["reason"], "not_applicable");
}

#[tokio::test]
async fn two_scratch_runs_never_share_a_design_directory() {
    let fixture = fixture().await;
    let mut second = scratch_request("plan");
    second["agent_run_id"] = serde_json::json!("11112222333344445555666677778888");

    let first = fixture.resolve(scratch_request("plan")).await;
    let second = fixture.resolve(second).await;

    assert_ne!(
        first["design_directory"], second["design_directory"],
        "independent scratch runs must not overwrite each other's artifacts"
    );
}

// ---------------------------------------------------------------------------
// 3. Doc-chat launches — the registered root, by identity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_doc_chat_run_is_rooted_at_the_registered_documents_root() {
    let fixture = fixture().await;
    let root = fixture.module_folder().join(PARENT_DESIGN_DIR);
    std::fs::create_dir_all(&root).expect("create the registered root");
    fixture
        .database
        .execute_unprepared(&format!(
            r#"INSERT INTO design_documents VALUES (
                '{DOCUMENT}', '{MODULE}', '{PARENT_TASK}', 'task', '{root}',
                'design.html', NULL, '2026-08-01T00:00:00+00:00',
                '2026-08-01T00:00:00+00:00', NULL
            );"#,
            root = root.display(),
        ))
        .await
        .expect("register the document");

    let paths = fixture
        .resolve(serde_json::json!({
            "version": 1,
            "scope": "docchat",
            "agent_run_id": RUN,
            "project_id": PROJECT,
            "module_id": MODULE,
            "document_id": DOCUMENT,
        }))
        .await;

    assert_eq!(paths["working_directory"], root.display().to_string());
    assert_eq!(paths["design_directory"], root.display().to_string());
    // The relative path comes from the registry row, never from the caller.
    assert_eq!(paths["document_relative_path"], "design.html");
}

#[tokio::test]
async fn an_unregistered_document_degrades_instead_of_failing_the_launch() {
    let fixture = fixture().await;

    let paths = fixture
        .resolve(serde_json::json!({
            "version": 1,
            "scope": "docchat",
            "agent_run_id": RUN,
            "project_id": PROJECT,
            "module_id": MODULE,
            "document_id": "80000000-0000-0000-0000-00000000ffff",
        }))
        .await;

    assert_eq!(paths["working_directory"], serde_json::Value::Null);
    assert_eq!(paths["design_directory"], serde_json::Value::Null);
}

// ---------------------------------------------------------------------------
// 4. The boundary's refusals
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_module_cannot_be_launched_as_a_task() {
    let fixture = fixture().await;

    let code = fixture.refuse(task_request(MODULE)).await;

    assert_eq!(code, LaunchPathsErrorCode::WorkItemInvalid);
}

#[tokio::test]
async fn a_submitted_module_is_checked_against_the_work_item_graph() {
    let fixture = fixture().await;
    let mut spoofed = task_request(PARENT_TASK);
    spoofed["module_id"] = serde_json::json!(OTHER_MODULE);

    let code = fixture.refuse(spoofed).await;

    assert_eq!(code, LaunchPathsErrorCode::ModuleMismatch);
}

#[tokio::test]
async fn an_unknown_work_item_is_not_a_launch() {
    let fixture = fixture().await;

    let code = fixture
        .refuse(task_request("60000000-0000-0000-0000-00000000ffff"))
        .await;

    assert_eq!(code, LaunchPathsErrorCode::WorkItemNotFound);
}

#[tokio::test]
async fn a_task_launch_without_a_work_item_is_refused() {
    let fixture = fixture().await;
    let mut body = task_request(PARENT_TASK);
    body["task_id"] = serde_json::Value::Null;

    let code = fixture.refuse(body).await;

    assert_eq!(code, LaunchPathsErrorCode::IdentityRequired);
}

#[tokio::test]
async fn an_unspoken_contract_version_is_refused() {
    let fixture = fixture().await;
    let mut body = task_request(PARENT_TASK);
    body["version"] = serde_json::json!(2);

    let code = fixture.refuse(body).await;

    assert_eq!(code, LaunchPathsErrorCode::UnsupportedVersion);
}

#[tokio::test]
async fn the_boundary_accepts_no_path_git_or_document_body_field() {
    for smuggled in ["path", "cwd", "root_dir", "repo_root", "branch", "content"] {
        let mut body = task_request(PARENT_TASK);
        body[smuggled] = serde_json::json!("/etc");

        assert!(
            serde_json::from_value::<LaunchPathsRequest>(body).is_err(),
            "the boundary accepted a `{smuggled}` field"
        );
    }
}
