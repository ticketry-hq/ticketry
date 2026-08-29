//! Creating a task worktree over real Git, through the composed GraphQL schema.
//!
//! Every case enters where Studio does — one Work Item identity and one
//! operation identity into `worktree_create` — and every assertion is checked
//! against the actual repository on disk, the actual index row, and the actual
//! durable journal. Nothing here simulates Git, and nothing constructs a
//! branch or a path on the caller's behalf.

use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use tauri_graphql::{TransportApi, TransportApiImpl};

const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
const SECOND_MODULE: &str = "20000000000000000000000000000002";
const UNLINKED_MODULE: &str = "20000000000000000000000000000003";
const PARENT_TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";
const UNLINKED_TASK: &str = "60000000000000000000000000000003";
const SECOND_TASK: &str = "60000000000000000000000000000004";

const CREATE: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_create(task_id: $taskId, operation_id: $operationId) {
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
// Real Git fixtures
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
        "git {arguments:?} failed: {}",
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

// ---------------------------------------------------------------------------
// Ticketry fixture
// ---------------------------------------------------------------------------

struct Fixture {
    directory: tempfile::TempDir,
    api: TransportApiImpl,
    repository_root: PathBuf,
    second_repository_root: PathBuf,
    base_commit: String,
}

/// One checkout base directory for the whole test process, because the base
/// is a process-wide setting. Fixtures stay isolated by giving every
/// repository a unique name, which is what the checkout path is keyed on.
fn checkout_base() -> &'static Path {
    static BASE: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
    let base = BASE.get_or_init(|| {
        let base = tempfile::tempdir().expect("create the shared checkout base");
        std::env::set_var("MUXED_WORKTREES_DIR", base.path());
        base
    });
    base.path()
}

/// A repository name no other test in this process uses.
fn unique(name: &str) -> String {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let index = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{name}-{index}")
}

/// One `worktrees` row, as the assertions read it.
struct IndexedWorktree {
    task_id: String,
    branch: String,
    base_branch: String,
    base_commit: String,
    path: String,
    status: String,
}

/// One journalled operation, as the assertions read it.
struct JournalledOperation {
    operation_id: String,
    kind: String,
    state: String,
    last_error_code: Option<String>,
}

/// One published durable fact.
struct PublishedFact {
    event_kind: String,
    work_item_id: Option<String>,
    payload: serde_json::Value,
}

impl Fixture {
    fn state(&self) -> PathBuf {
        self.directory.path().join("state.db")
    }

    fn checkout(&self, repository: &Path, name: &str) -> PathBuf {
        checkout_base()
            .join(repository.file_name().expect("a repository directory name"))
            .join(name)
    }

    async fn database(&self) -> DatabaseConnection {
        Database::connect(format!("sqlite:{}?mode=rwc", self.state().display()))
            .await
            .expect("open the fixture store")
    }

    async fn execute(&self, document: &str, variables: serde_json::Value) -> serde_json::Value {
        let response = self
            .api
            .clone()
            .graphql_execute(
                serde_json::json!({ "query": document, "variables": variables }).to_string(),
            )
            .await;
        serde_json::from_str(&response).expect("decode the GraphQL response")
    }

    async fn create(&self, task_id: &str, operation_id: &str) -> serde_json::Value {
        self.execute(
            CREATE,
            serde_json::json!({ "taskId": task_id, "operationId": operation_id }),
        )
        .await
    }

    /// A successful creation, with its errors asserted away.
    async fn created(&self, task_id: &str, operation_id: &str) -> serde_json::Value {
        let response = self.create(task_id, operation_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_create"].clone()
    }

    async fn rows(&self) -> Vec<IndexedWorktree> {
        rows(
            &self.database().await,
            "SELECT task_id, branch, base_branch, base_commit, path, status FROM worktrees ORDER BY task_id",
        )
        .await
        .into_iter()
        .map(|row| IndexedWorktree {
            task_id: text(&row, 0),
            branch: text(&row, 1),
            base_branch: text(&row, 2),
            base_commit: text(&row, 3),
            path: text(&row, 4),
            status: text(&row, 5),
        })
        .collect()
    }

    async fn operations(&self) -> Vec<JournalledOperation> {
        rows(
            &self.database().await,
            "SELECT operation_id, kind, state, last_error_code FROM workspace_operations ORDER BY created_at, operation_id",
        )
        .await
        .into_iter()
        .map(|row| JournalledOperation {
            operation_id: text(&row, 0),
            kind: text(&row, 1),
            state: text(&row, 2),
            last_error_code: optional_text(&row, 3),
        })
        .collect()
    }

    async fn facts(&self) -> Vec<PublishedFact> {
        rows(
            &self.database().await,
            "SELECT event_kind, work_item_id, payload FROM runs_status_events ORDER BY cursor",
        )
        .await
        .into_iter()
        .map(|row| PublishedFact {
            event_kind: text(&row, 0),
            work_item_id: optional_text(&row, 1),
            payload: serde_json::from_str(&text(&row, 2)).expect("decode a published payload"),
        })
        .collect()
    }

    /// The project each fact was partitioned into, with its payload version.
    async fn fact_scope(&self) -> Vec<(String, i32)> {
        rows(
            &self.database().await,
            "SELECT project_id, payload_version FROM runs_status_events ORDER BY cursor",
        )
        .await
        .into_iter()
        .map(|row| {
            (
                text(&row, 0),
                row.try_get_by_index::<i32>(1)
                    .expect("read the payload version"),
            )
        })
        .collect()
    }

    /// Recompose the application over the very same data directory, which is
    /// what a restart does — including its startup reconciliation pass.
    async fn restart(&mut self) {
        let api = TransportApiImpl::new();
        install(&api, self.directory.path()).await;
        self.api = api;
    }
}

/// Point one module at one local repository, through the one write seam.
async fn link_module(database: &DatabaseConnection, module_id: &str, repository: &Path) {
    muxed_studio_lib::module_links::schema::install(database)
        .await
        .expect("install the Module Link schema");
    muxed_studio_lib::module_links::ModuleLinkStore::new(database.clone())
        .set(module_id, &repository.display().to_string())
        .await
        .expect("link the fixture module");
}

async fn rows(database: &DatabaseConnection, sql: &str) -> Vec<sea_orm::QueryResult> {
    database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .expect("read the fixture store")
}

fn text(row: &sea_orm::QueryResult, index: usize) -> String {
    row.try_get_by_index::<String>(index)
        .expect("read a text column")
}

fn optional_text(row: &sea_orm::QueryResult, index: usize) -> Option<String> {
    row.try_get_by_index::<Option<String>>(index)
        .expect("read an optional text column")
}

async fn install(api: &TransportApiImpl, directory: &Path) {
    initialize_with_worktracker_commands_and_install(
        &directory.join("rust-core.sqlite3"),
        &directory.join("state.db"),
        &directory.join("media"),
        api,
    )
    .await
    .expect("compose the worktree creation schema");
}

/// Two linked modules over two real repositories, one unlinked module, a
/// parent story with a child, and the durable outbox the facts land in.
async fn fixture() -> Fixture {
    // Checkouts land in this process's shared base rather than a developer's
    // home directory.
    checkout_base();
    let directory = tempfile::tempdir().expect("create the creation fixture directory");
    let repository_root = directory
        .path()
        .join("repositories")
        .join(unique("ticketry"));
    let second_repository_root = directory.path().join("repositories").join(unique("other"));
    let base_commit = repository(&repository_root);
    repository(&second_repository_root);

    let writer = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
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
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                ('{SECOND_MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Other', 879, 0, 'ya', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{UNLINKED_MODULE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL,
                 '{BACKLOG}', 1, 'Unlinked', 878, 0, 'yb', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{PARENT_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Parent story', 881, 0, 'z', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{PARENT_TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{UNLINKED_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{UNLINKED_MODULE}',
                 '{UNLINKED_MODULE}', '{BACKLOG}', 1, 'Unlinked story', 883, 0, 'zb', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{SECOND_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{SECOND_MODULE}',
                 '{SECOND_MODULE}', '{BACKLOG}', 1, 'Second story', 884, 0, 'zc', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the worktree creation fixture");
    // A module's repository is its typed link, so a creation resolves it from
    // the installation rather than from whichever profile is selected.
    link_module(&writer, MODULE, &repository_root).await;
    link_module(&writer, SECOND_MODULE, &second_repository_root).await;
    drop(writer);

    let api = TransportApiImpl::new();
    install(&api, directory.path()).await;

    Fixture {
        directory,
        api,
        repository_root,
        second_repository_root,
        base_commit,
    }
}

// ---------------------------------------------------------------------------
// 1. Creation derives everything from one identity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn creation_derives_the_branch_checkout_and_base_from_the_work_item_alone() {
    let fixture = fixture().await;
    // An uncommitted change in the primary checkout must not be carried into
    // the isolated one: the commit, not the working tree, is the base.
    write(&fixture.repository_root.join("README.md"), "uncommitted\n");

    let created = fixture
        .created(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    let checkout = fixture.checkout(&fixture.repository_root, "CODIN-881-parent-story");
    assert_eq!(created["kind"], "worktree");
    assert_eq!(created["branch"], "wt/CODIN-881-parent-story");
    assert_eq!(created["base_branch"], "main");
    assert_eq!(created["path"], checkout.display().to_string());
    assert_eq!(created["state"], "active");
    assert_eq!(created["clean"], true);
    assert_eq!(created["checkout_present"], true);
    assert_eq!(created["is_shared"], false);
    assert_eq!(created["ephemeral"], false);

    // Git, not the response, is the authority for what exists.
    assert_eq!(git(&["rev-parse", "HEAD"], &checkout), fixture.base_commit);
    assert_eq!(
        git(&["rev-parse", "--abbrev-ref", "HEAD"], &checkout),
        "wt/CODIN-881-parent-story"
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("README.md")).expect("read the isolated file"),
        "base\n",
        "uncommitted primary changes are not copied into the worktree"
    );

    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].branch, "wt/CODIN-881-parent-story");
    assert_eq!(rows[0].base_commit, fixture.base_commit);
    assert_eq!(rows[0].status, "active");

    let operations = fixture.operations().await;
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].kind, "worktree_create");
    assert_eq!(operations[0].state, "applied");

    let facts = fixture.facts().await;
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].event_kind, "worktree.changed");
    assert_eq!(facts[0].work_item_id.as_deref(), Some(PARENT_TASK));
    assert_eq!(facts[0].payload["changeKind"], "created");
    assert_eq!(facts[0].payload["branch"], "wt/CODIN-881-parent-story");
}

#[tokio::test]
async fn a_detached_repository_records_its_commit_as_the_integration_target() {
    let fixture = fixture().await;
    git(&["checkout", "--detach"], &fixture.repository_root);

    let created = fixture
        .created(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(created["kind"], "worktree");
    assert_eq!(created["base_branch"], fixture.base_commit);
}

#[tokio::test]
async fn a_child_creates_and_then_shares_its_top_level_parents_checkout() {
    let fixture = fixture().await;

    let created = fixture
        .created(CHILD_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(created["kind"], "worktree");
    assert_eq!(created["task_id"], public(CHILD_TASK));
    assert_eq!(created["top_level_task_id"], public(PARENT_TASK));
    assert_eq!(created["is_shared"], true);
    assert_eq!(created["branch"], "wt/CODIN-881-parent-story");

    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "one story owns one checkout");
    assert_eq!(rows[0].task_id, PARENT_TASK);

    // The durable fact addresses the checkout's owner, not the Work Item the
    // caller happened to ask from: a child view and its parent's view converge
    // on one holding because they are told about one owner.
    let facts = fixture.facts().await;
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].event_kind, "worktree.changed");
    assert_eq!(facts[0].work_item_id.as_deref(), Some(PARENT_TASK));
    assert_eq!(facts[0].payload["topLevelTaskId"], public(PARENT_TASK));
    assert_eq!(facts[0].payload["taskId"], public(PARENT_TASK));
    assert_eq!(facts[0].payload["changeKind"], "created");
    assert_eq!(facts[0].payload["removed"], false);
    assert_eq!(facts[0].payload["state"], "active");
    assert!(
        facts[0].payload.get("path").is_none() && facts[0].payload.get("repoRoot").is_none(),
        "a fact names identities and refs, never a local path"
    );
    assert_eq!(
        fixture.fact_scope().await,
        vec![(PROJECT.to_owned(), 1)],
        "the project is resolved from the owning Work Item, at a read version"
    );
}

#[tokio::test]
async fn a_work_item_with_no_linked_repository_reports_no_repo_rather_than_failing() {
    let fixture = fixture().await;

    let created = fixture
        .created(UNLINKED_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(created["kind"], "no_repo");
    assert_eq!(
        created["reason"],
        "no local folder is linked to this module"
    );
    assert!(fixture.rows().await.is_empty());
    assert!(
        fixture.operations().await.is_empty(),
        "nothing that cannot run is journalled"
    );
}

#[tokio::test]
async fn a_module_cannot_own_a_checkout() {
    let fixture = fixture().await;

    let response = fixture
        .create(MODULE, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_work_item_invalid",
        "{response}"
    );
    assert!(fixture.rows().await.is_empty());
}

// ---------------------------------------------------------------------------
// 2. Repetition converges
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_same_operation_identity_returns_the_same_worktree() {
    let fixture = fixture().await;
    let operation = uuid::Uuid::new_v4().to_string();

    let first = fixture.created(PARENT_TASK, &operation).await;
    let second = fixture.created(PARENT_TASK, &operation).await;

    assert_eq!(first, second);
    assert_eq!(fixture.rows().await.len(), 1);
    assert_eq!(fixture.operations().await.len(), 1);
    assert_eq!(
        branches(&fixture.repository_root)
            .iter()
            .filter(|branch| branch.starts_with("wt/"))
            .count(),
        1
    );
    assert_eq!(fixture.facts().await.len(), 1, "one creation, one fact");
}

#[tokio::test]
async fn concurrent_creations_for_one_work_item_converge_on_one_checkout() {
    let fixture = fixture().await;

    let (one, two) = (
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
    );
    let (first, second) = tokio::join!(
        fixture.create(PARENT_TASK, &one),
        fixture.create(PARENT_TASK, &two),
    );

    for response in [&first, &second] {
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        assert_eq!(response["data"]["worktree_create"]["kind"], "worktree");
        assert_eq!(
            response["data"]["worktree_create"]["branch"],
            "wt/CODIN-881-parent-story"
        );
    }
    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "one row survives the race");
    assert_eq!(
        branches(&fixture.repository_root)
            .iter()
            .filter(|branch| branch.starts_with("wt/"))
            .count(),
        1
    );
    assert_eq!(
        fixture.facts().await.len(),
        1,
        "only the creation that happened is published"
    );
}

#[tokio::test]
async fn two_repositories_create_concurrently() {
    let fixture = fixture().await;

    let (one, two) = (
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
    );
    let (first, second) = tokio::join!(
        fixture.create(PARENT_TASK, &one),
        fixture.create(SECOND_TASK, &two),
    );

    assert_eq!(
        first["data"]["worktree_create"]["kind"], "worktree",
        "{first}"
    );
    assert_eq!(
        second["data"]["worktree_create"]["kind"], "worktree",
        "{second}"
    );
    assert_eq!(fixture.rows().await.len(), 2);
    assert_eq!(
        git(
            &["rev-parse", "--abbrev-ref", "HEAD"],
            &fixture.checkout(&fixture.second_repository_root, "CODIN-884-second-story")
        ),
        "wt/CODIN-884-second-story"
    );
}

#[tokio::test]
async fn reusing_an_operation_identity_for_different_intent_is_refused() {
    let fixture = fixture().await;
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.created(PARENT_TASK, &operation).await;
    // The first operation is durable under the parent story's intent; the
    // second Work Item resolves to a different branch and checkout entirely.
    let response = fixture.create(SECOND_TASK, &operation).await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_operation_replay_mismatch",
        "{response}"
    );
    assert_eq!(fixture.rows().await.len(), 1);
}

// ---------------------------------------------------------------------------
// 3. External state is reported, never overwritten
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_pre_existing_branch_is_a_durable_conflict_rather_than_a_reset() {
    let fixture = fixture().await;
    write(&fixture.repository_root.join("other.md"), "other\n");
    git(&["add", "."], &fixture.repository_root);
    git(&["commit", "-m", "second"], &fixture.repository_root);
    let foreign_tip = git(&["rev-parse", "HEAD"], &fixture.repository_root);
    git(
        &["branch", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );

    let response = fixture
        .create(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_external_conflict",
        "{response}"
    );
    assert!(fixture.rows().await.is_empty(), "no row indexes a conflict");
    assert_eq!(
        git(
            &["rev-parse", "wt/CODIN-881-parent-story"],
            &fixture.repository_root
        ),
        foreign_tip,
        "the pre-existing branch is left exactly where it was"
    );
    let operations = fixture.operations().await;
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].state, "conflicted");
    assert_eq!(
        operations[0].last_error_code.as_deref(),
        Some("worktree_branch_exists")
    );
    assert!(
        fixture.facts().await.is_empty(),
        "a conflict publishes nothing"
    );
}

#[tokio::test]
async fn an_occupied_checkout_path_is_a_durable_conflict() {
    let fixture = fixture().await;
    let checkout = fixture.checkout(&fixture.repository_root, "CODIN-881-parent-story");
    write(&checkout.join("someone-elses-work.txt"), "keep me\n");

    let response = fixture
        .create(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_external_conflict",
        "{response}"
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("someone-elses-work.txt")).expect("read"),
        "keep me\n",
        "recovery never force-removes what it did not create"
    );
    assert_eq!(
        fixture.operations().await[0].last_error_code.as_deref(),
        Some("worktree_path_taken")
    );
}

// ---------------------------------------------------------------------------
// 4. Crash boundaries converge on restart
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_checkout_cut_before_the_crash_is_adopted_rather_than_created_twice() {
    let mut fixture = fixture().await;
    // The crash window: the operation is prepared and Git already cut the
    // checkout, but the row and the fact never committed.
    let operation = prepared_operation(&fixture, PARENT_TASK).await;
    let checkout = fixture.checkout(&fixture.repository_root, "CODIN-881-parent-story");
    std::fs::create_dir_all(checkout.parent().expect("a parent")).expect("create the base");
    git(
        &[
            "worktree",
            "add",
            "-b",
            "wt/CODIN-881-parent-story",
            &checkout.display().to_string(),
            &fixture.base_commit,
        ],
        &fixture.repository_root,
    );

    fixture.restart().await;

    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "the abandoned checkout is adopted");
    assert_eq!(rows[0].branch, "wt/CODIN-881-parent-story");
    assert_eq!(rows[0].base_commit, fixture.base_commit);
    let operations = fixture.operations().await;
    assert_eq!(operations[0].operation_id, operation);
    assert_eq!(operations[0].state, "applied");
    assert_eq!(
        branches(&fixture.repository_root)
            .iter()
            .filter(|branch| branch.starts_with("wt/"))
            .count(),
        1,
        "no second branch is ever cut"
    );

    // A second restart changes nothing.
    fixture.restart().await;
    assert_eq!(fixture.rows().await.len(), 1);
    assert_eq!(fixture.facts().await.len(), 1);
}

#[tokio::test]
async fn a_prepared_operation_whose_effect_never_ran_is_executed_on_restart() {
    let mut fixture = fixture().await;
    let operation = prepared_operation(&fixture, PARENT_TASK).await;

    fixture.restart().await;

    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "the intended checkout is completed");
    assert_eq!(rows[0].branch, "wt/CODIN-881-parent-story");
    let checkout = fixture.checkout(&fixture.repository_root, "CODIN-881-parent-story");
    assert_eq!(
        git(&["rev-parse", "--abbrev-ref", "HEAD"], &checkout),
        "wt/CODIN-881-parent-story"
    );
    let operations = fixture.operations().await;
    assert_eq!(operations[0].operation_id, operation);
    assert_eq!(operations[0].state, "applied");

    // Asking again after recovery is the ordinary idempotent answer.
    let created = fixture.created(PARENT_TASK, &operation).await;
    assert_eq!(created["branch"], "wt/CODIN-881-parent-story");
    assert_eq!(fixture.rows().await.len(), 1);
}

#[tokio::test]
async fn a_repository_that_moved_under_a_prepared_operation_becomes_a_conflict() {
    let mut fixture = fixture().await;
    let operation = prepared_operation(&fixture, PARENT_TASK).await;
    // The module is repointed at a different repository while the operation is
    // still open. Its intent no longer describes anything that may be created.
    let repointed = fixture.second_repository_root.clone();
    link_module(&fixture.database().await, MODULE, &repointed).await;

    fixture.restart().await;

    let operations = fixture.operations().await;
    assert_eq!(operations[0].operation_id, operation);
    assert_eq!(operations[0].state, "conflicted");
    assert_eq!(
        operations[0].last_error_code.as_deref(),
        Some("worktree_repository_mismatch")
    );
    assert!(fixture.rows().await.is_empty());
    assert!(
        branches(&fixture.second_repository_root)
            .iter()
            .all(|branch| !branch.starts_with("wt/")),
        "nothing is created in the repository the module now points at"
    );
}

/// Journal a prepared creation exactly as the mutation does, and stop there —
/// the durable state a process that died mid-effect leaves behind.
async fn prepared_operation(fixture: &Fixture, task_id: &str) -> String {
    let operation = uuid::Uuid::new_v4().simple().to_string();
    let intent = serde_json::json!({
        "kind": "worktree_create",
        "intentVersion": 1,
        "payload": {
            "branch": "wt/CODIN-881-parent-story",
            "checkoutName": "CODIN-881-parent-story",
            "repositoryDigest": repository_digest(&fixture.repository_root),
            "taskId": task_id,
        },
        "resourceKey": format!("worktree/{task_id}"),
        "resourceKind": "worktree",
    });
    let canonical = canonical_json(&intent);
    let database = fixture.database().await;
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO workspace_operations
                 (operation_id, kind, intent_version, resource_kind, resource_key,
                  intent, intent_fingerprint, state)
               VALUES (?, 'worktree_create', 1, 'worktree', ?, ?, ?, 'prepared')"#,
            [
                operation.clone().into(),
                format!("worktree/{task_id}").into(),
                canonical.clone().into(),
                fingerprint(&canonical).into(),
            ],
        ))
        .await
        .expect("journal a prepared creation");
    operation
}

/// The journal's canonical form: key-sorted, no incidental whitespace.
fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(entries) => {
            let mut keys = entries.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let rendered = keys
                .into_iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::Value::String(key.clone()),
                        canonical_json(&entries[key])
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{rendered}}}")
        }
        serde_json::Value::Array(items) => format!(
            "[{}]",
            items
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        scalar => scalar.to_string(),
    }
}

fn fingerprint(canonical: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn repository_digest(repository: &Path) -> String {
    use sha2::{Digest, Sha256};
    let canonical = repository
        .canonicalize()
        .unwrap_or_else(|_| repository.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn branches(repository: &Path) -> Vec<String> {
    git(&["branch", "--format=%(refname:short)"], repository)
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .collect()
}

fn public(compact: &str) -> String {
    uuid::Uuid::parse_str(compact)
        .expect("a fixture identity")
        .hyphenated()
        .to_string()
}

// ---------------------------------------------------------------------------
// 5. The public write surface stays exactly one restricted seam
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_only_public_worktree_write_is_the_restricted_create() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build the shipping schema");

    assert!(
        sdl.contains(
            "worktree_create(task_id: String!, operation_id: String!): WorktreeStatusView!"
        ),
        "the restricted create seam must stay exactly this shape"
    );
    for generated in [
        "worktreesCreateOne",
        "worktreesCreateBatch",
        "worktreesUpdate",
        "worktreesDelete",
    ] {
        assert!(
            !sdl.contains(generated),
            "the generated Worktree mutation bundle must stay private ({generated})"
        );
    }
    assert!(
        !sdl.contains("WorktreesInsertInput"),
        "no generated Worktree input may reach the public contract"
    );
}
