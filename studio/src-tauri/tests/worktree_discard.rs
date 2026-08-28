//! Discarding a task worktree over real Git, through the composed GraphQL
//! schema.
//!
//! Every case enters where Studio does — one Work Item identity and one
//! operation identity into `worktree_discard`, after the user has confirmed —
//! and every assertion is checked against the actual repository on disk, the
//! actual index row, and the actual durable journal. Nothing here simulates
//! Git, and nothing hands the mutation a path, a branch, or a repository.
//!
//! The theme throughout is scope: a discard must remove the one checkout
//! Ticketry indexed and nothing adjacent to it, must be harmless when
//! repeated, and must complete an interrupted removal without erasing anything
//! that has since come to belong to someone else.

use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use tauri_graphql::{TransportApi, TransportApiImpl};

const WORKSPACE: &str = "90000000000000000000000000000000";
const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const MODULE: &str = "20000000000000000000000000000001";
const SECOND_MODULE: &str = "20000000000000000000000000000002";
const PARENT_TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";
const SECOND_TASK: &str = "60000000000000000000000000000004";

const PARENT_CHECKOUT: &str = "CODIN-881-parent-story";
const PARENT_BRANCH: &str = "wt/CODIN-881-parent-story";

const CREATE: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_create(task_id: $taskId, operation_id: $operationId) { kind branch path }
}"#;

const DISCARD: &str = r#"mutation($taskId: String!, $operationId: String!) {
  worktree_discard(task_id: $taskId, operation_id: $operationId) {
    removed
    task_id
    top_level_task_id
    branch
    reason
    status { kind branch path is_shared reason }
  }
}"#;

const STATUS: &str = r#"query($taskId: String!) {
  worktree_status(task_id: $taskId) { kind branch }
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

fn branches(repository: &Path) -> Vec<String> {
    git(&["branch", "--format=%(refname:short)"], repository)
        .lines()
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Every checkout Git registers for a repository, as the assertions read it.
fn registered(repository: &Path) -> Vec<String> {
    git(&["worktree", "list", "--porcelain"], repository)
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(|path| path.trim().to_owned())
        .collect()
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

/// One checkout base directory for the whole test process, because the base is
/// a process-wide setting. Fixtures stay isolated by giving every repository a
/// unique name, which is what the checkout path is keyed on.
fn checkout_base() -> &'static Path {
    static BASE: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
    let base = BASE.get_or_init(|| {
        let base = tempfile::tempdir().expect("create the shared checkout base");
        std::env::set_var("MUXED_WORKTREES_DIR", base.path());
        base
    });
    base.path()
}

fn unique(name: &str) -> String {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let index = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{name}-{index}")
}

/// One `worktrees` row, as the assertions read it.
struct IndexedWorktree {
    id: String,
    task_id: String,
    branch: String,
    path: String,
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

    /// The checkout the parent story's worktree occupies.
    fn parent_checkout(&self) -> PathBuf {
        self.checkout(&self.repository_root, PARENT_CHECKOUT)
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

    /// A successful creation, so a discard has something to remove.
    async fn create(&self, task_id: &str) -> serde_json::Value {
        let response = self
            .execute(
                CREATE,
                serde_json::json!({
                    "taskId": task_id,
                    "operationId": uuid::Uuid::new_v4().to_string(),
                }),
            )
            .await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_create"].clone()
    }

    async fn discard(&self, task_id: &str, operation_id: &str) -> serde_json::Value {
        self.execute(
            DISCARD,
            serde_json::json!({ "taskId": task_id, "operationId": operation_id }),
        )
        .await
    }

    /// A discard with its errors asserted away.
    async fn discarded(&self, task_id: &str, operation_id: &str) -> serde_json::Value {
        let response = self.discard(task_id, operation_id).await;
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        response["data"]["worktree_discard"].clone()
    }

    async fn rows(&self) -> Vec<IndexedWorktree> {
        rows(
            &self.database().await,
            "SELECT id, task_id, branch, path FROM worktrees ORDER BY task_id",
        )
        .await
        .into_iter()
        .map(|row| IndexedWorktree {
            id: text(&row, 0),
            task_id: text(&row, 1),
            branch: text(&row, 2),
            path: text(&row, 3),
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

    /// The discard operations only, so a creation in the same fixture does not
    /// have to be counted around.
    async fn discards(&self) -> Vec<JournalledOperation> {
        self.operations()
            .await
            .into_iter()
            .filter(|operation| operation.kind == "worktree_discard")
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

    async fn deletions(&self) -> Vec<PublishedFact> {
        self.facts()
            .await
            .into_iter()
            .filter(|fact| fact.event_kind == "worktree.deleted")
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
    .expect("compose the worktree discard schema");
}

/// Two linked modules over two real repositories, a parent story with a child,
/// and the durable outbox the facts land in.
async fn fixture() -> Fixture {
    checkout_base();
    let directory = tempfile::tempdir().expect("create the discard fixture directory");
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
                ('{PARENT_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Parent story', 881, 0, 'z', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{PARENT_TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{SECOND_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{SECOND_MODULE}',
                 '{SECOND_MODULE}', '{BACKLOG}', 1, 'Second story', 884, 0, 'zc', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the worktree discard fixture");
    drop(writer);

    write(
        &directory.path().join("profiles.json"),
        &serde_json::json!({
            "recent_profile_index": 0,
            "profiles": [{
                "name": "Local",
                "workspace_slug": "meml",
                "module_links": [
                    { "module_id": MODULE, "path": repository_root.display().to_string() },
                    {
                        "module_id": SECOND_MODULE,
                        "path": second_repository_root.display().to_string()
                    }
                ]
            }]
        })
        .to_string(),
    );

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
// 1. A discard removes exactly the journaled checkout and its branch
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_discard_removes_the_checkout_the_branch_and_the_row() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let checkout = fixture.parent_checkout();
    // Uncommitted work in the isolated checkout is exactly what a discard
    // throws away, and exactly why Studio confirms first.
    write(&checkout.join("scratch.txt"), "abandoned\n");

    let discarded = fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(discarded["removed"], true);
    assert_eq!(discarded["branch"], PARENT_BRANCH);
    assert_eq!(discarded["reason"], serde_json::Value::Null);
    // The response is the authoritative status afterwards, so the confirming
    // window does not have to refetch to be correct.
    assert_eq!(discarded["status"]["kind"], "none");
    assert_eq!(discarded["status"]["branch"], serde_json::Value::Null);

    // Git, not the response, is the authority for what is gone.
    assert!(!checkout.exists(), "the checkout directory is removed");
    assert_eq!(
        registered(&fixture.repository_root),
        vec![fixture
            .repository_root
            .canonicalize()
            .expect("canonicalize")
            .display()
            .to_string()],
        "only the primary checkout remains registered"
    );
    assert_eq!(
        branches(&fixture.repository_root),
        vec!["main".to_owned()],
        "only the task branch is deleted"
    );
    assert!(fixture.rows().await.is_empty());

    let discards = fixture.discards().await;
    assert_eq!(discards.len(), 1);
    assert_eq!(discards[0].state, "applied");

    let deletions = fixture.deletions().await;
    assert_eq!(deletions.len(), 1);
    assert_eq!(deletions[0].work_item_id.as_deref(), Some(PARENT_TASK));
    assert_eq!(deletions[0].payload["changeKind"], "discarded");
    assert_eq!(deletions[0].payload["removed"], true);
    assert_eq!(deletions[0].payload["branch"], PARENT_BRANCH);
}

#[tokio::test]
async fn a_discard_leaves_every_neighbouring_checkout_and_branch_alone() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    // A second worktree of the same repository, cut by someone else. Nothing
    // about this discard may reach it.
    let neighbour = fixture.checkout(&fixture.repository_root, "someone-elses-tree");
    std::fs::create_dir_all(neighbour.parent().expect("a parent")).expect("create the base");
    git(
        &[
            "worktree",
            "add",
            "-b",
            "wt/someone-else",
            &neighbour.display().to_string(),
            &fixture.base_commit,
        ],
        &fixture.repository_root,
    );
    // And a worktree of an unrelated repository entirely.
    fixture.create(SECOND_TASK).await;

    fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert!(neighbour.is_dir(), "the neighbouring checkout survives");
    assert!(branches(&fixture.repository_root).contains(&"wt/someone-else".to_owned()));
    assert!(!fixture.parent_checkout().exists());
    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "only the discarded row is deleted");
    assert_eq!(rows[0].task_id, SECOND_TASK);
    assert!(
        fixture
            .checkout(&fixture.second_repository_root, "CODIN-884-second-story")
            .is_dir(),
        "the other repository's checkout is untouched"
    );
}

#[tokio::test]
async fn a_child_discards_the_checkout_its_parent_owns() {
    let fixture = fixture().await;
    fixture.create(CHILD_TASK).await;

    let discarded = fixture
        .discarded(CHILD_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(discarded["removed"], true);
    assert_eq!(discarded["task_id"], public(CHILD_TASK));
    assert_eq!(discarded["top_level_task_id"], public(PARENT_TASK));
    assert!(fixture.rows().await.is_empty());
    assert!(!fixture.parent_checkout().exists());
}

#[tokio::test]
async fn a_module_cannot_have_a_worktree_discarded() {
    let fixture = fixture().await;

    let response = fixture
        .discard(MODULE, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_work_item_invalid",
        "{response}"
    );
    assert!(fixture.operations().await.is_empty());
}

// ---------------------------------------------------------------------------
// 2. Repetition is harmless, and a replay is the durable prior answer
// ---------------------------------------------------------------------------

#[tokio::test]
async fn discarding_a_work_item_with_no_worktree_removes_nothing() {
    let fixture = fixture().await;

    let discarded = fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(discarded["removed"], false);
    assert_eq!(discarded["reason"], "no worktree for this Work Item");
    assert_eq!(discarded["branch"], serde_json::Value::Null);
    assert_eq!(discarded["status"]["kind"], "none");
    assert!(
        fixture.operations().await.is_empty(),
        "nothing that has no effect to recover is journalled"
    );
    assert!(fixture.facts().await.is_empty());
}

#[tokio::test]
async fn a_second_discard_under_a_new_identity_reports_nothing_left_to_remove() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;

    let first = fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;
    let second = fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(first["removed"], true);
    assert_eq!(second["removed"], false);
    assert_eq!(second["reason"], "no worktree for this Work Item");
    assert_eq!(fixture.discards().await.len(), 1, "the second is a no-op");
    assert_eq!(fixture.deletions().await.len(), 1, "one removal, one fact");
}

#[tokio::test]
async fn replaying_one_operation_identity_returns_its_durable_result() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let operation = uuid::Uuid::new_v4().to_string();

    let first = fixture.discarded(PARENT_TASK, &operation).await;
    // The lost-response case: the same intent arrives again under the same
    // identity, and must not be answered "there was nothing to remove".
    let second = fixture.discarded(PARENT_TASK, &operation).await;

    assert_eq!(first["removed"], true);
    assert_eq!(second["removed"], true);
    assert_eq!(second["branch"], PARENT_BRANCH);
    assert_eq!(second["status"]["kind"], "none");
    assert_eq!(fixture.discards().await.len(), 1);
    assert_eq!(fixture.deletions().await.len(), 1);
}

#[tokio::test]
async fn reusing_an_operation_identity_for_a_different_worktree_is_refused() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    fixture.create(SECOND_TASK).await;
    let operation = uuid::Uuid::new_v4().to_string();
    fixture.discarded(PARENT_TASK, &operation).await;

    let response = fixture.discard(SECOND_TASK, &operation).await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_operation_replay_mismatch",
        "{response}"
    );
    let rows = fixture.rows().await;
    assert_eq!(rows.len(), 1, "the second checkout is not discarded");
    assert_eq!(rows[0].task_id, SECOND_TASK);
    assert!(fixture
        .checkout(&fixture.second_repository_root, "CODIN-884-second-story")
        .is_dir());
}

#[tokio::test]
async fn concurrent_discards_of_one_checkout_converge_on_one_removal() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;

    let (one, two) = (
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
    );
    let (first, second) = tokio::join!(
        fixture.discard(PARENT_TASK, &one),
        fixture.discard(PARENT_TASK, &two),
    );

    for response in [&first, &second] {
        assert_eq!(response["errors"], serde_json::Value::Null, "{response}");
        assert_eq!(
            response["data"]["worktree_discard"]["status"]["kind"],
            "none"
        );
    }
    assert!(fixture.rows().await.is_empty());
    assert!(!fixture.parent_checkout().exists());
    assert_eq!(
        fixture.deletions().await.len(),
        1,
        "only the removal that happened is published"
    );
}

#[tokio::test]
async fn a_status_read_and_a_discard_of_one_repository_serialize() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;

    let operation = uuid::Uuid::new_v4().to_string();
    let (status, discarded) = tokio::join!(
        fixture.execute(STATUS, serde_json::json!({ "taskId": PARENT_TASK })),
        fixture.discard(PARENT_TASK, &operation),
    );

    assert_eq!(status["errors"], serde_json::Value::Null, "{status}");
    assert_eq!(discarded["errors"], serde_json::Value::Null, "{discarded}");
    // The read either saw the live checkout or saw it gone; both are coherent
    // answers, and neither is a half-removed one.
    let observed = status["data"]["worktree_status"]["kind"]
        .as_str()
        .expect("a status kind")
        .to_owned();
    assert!(matches!(observed.as_str(), "worktree" | "none"), "{status}");
    assert!(fixture.rows().await.is_empty());
}

// ---------------------------------------------------------------------------
// 3. External ownership is reported, never force-cleaned
// ---------------------------------------------------------------------------

#[tokio::test]
async fn foreign_content_at_the_recorded_path_is_a_conflict_rather_than_a_deletion() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let checkout = fixture.parent_checkout();
    // The checkout is released out of band and the path reused by something
    // Git does not track at all.
    git(
        &[
            "worktree",
            "remove",
            "--force",
            &checkout.display().to_string(),
        ],
        &fixture.repository_root,
    );
    write(&checkout.join("someone-elses-work.txt"), "keep me\n");

    let response = fixture
        .discard(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_external_conflict",
        "{response}"
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("someone-elses-work.txt")).expect("read"),
        "keep me\n",
        "a discard never force-removes what it did not create"
    );
    assert_eq!(fixture.rows().await.len(), 1, "no row indexes a conflict");
    let discards = fixture.discards().await;
    assert_eq!(discards[0].state, "conflicted");
    assert_eq!(
        discards[0].last_error_code.as_deref(),
        Some("worktree_path_taken")
    );
    assert!(fixture.deletions().await.is_empty());
}

#[tokio::test]
async fn a_task_branch_checked_out_elsewhere_is_a_conflict_rather_than_a_deletion() {
    let fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let moved = fixture.checkout(&fixture.repository_root, "moved-by-hand");
    git(
        &[
            "worktree",
            "move",
            &fixture.parent_checkout().display().to_string(),
            &moved.display().to_string(),
        ],
        &fixture.repository_root,
    );

    let response = fixture
        .discard(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;

    assert_eq!(
        response["errors"][0]["extensions"]["code"], "worktree_external_conflict",
        "{response}"
    );
    assert!(moved.is_dir(), "the relocated checkout survives");
    assert!(branches(&fixture.repository_root).contains(&PARENT_BRANCH.to_owned()));
    assert_eq!(fixture.rows().await.len(), 1);
    assert_eq!(
        fixture.discards().await[0].last_error_code.as_deref(),
        Some("worktree_branch_checked_out_elsewhere")
    );
}

#[tokio::test]
async fn a_row_that_moved_under_a_prepared_discard_becomes_a_conflict() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let operation = prepared_discard(&fixture).await;
    // The index row is repointed at a different branch while the discard is
    // still open. Its intent no longer describes anything that may be removed.
    fixture
        .database()
        .await
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE worktrees SET branch = 'wt/CODIN-881-something-else'".to_owned(),
        ))
        .await
        .expect("repoint the index row");

    fixture.restart().await;

    let discards = fixture.discards().await;
    assert_eq!(discards[0].operation_id, operation);
    assert_eq!(discards[0].state, "conflicted");
    assert_eq!(
        discards[0].last_error_code.as_deref(),
        Some("worktree_row_mismatch")
    );
    assert_eq!(fixture.rows().await.len(), 1, "nothing is deleted");
    assert!(fixture.parent_checkout().is_dir());
}

// ---------------------------------------------------------------------------
// 4. Every crash boundary converges on restart
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_discard_that_never_ran_is_completed_on_restart() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let operation = prepared_discard(&fixture).await;

    fixture.restart().await;

    assert!(!fixture.parent_checkout().exists());
    assert_eq!(branches(&fixture.repository_root), vec!["main".to_owned()]);
    assert!(fixture.rows().await.is_empty());
    let discards = fixture.discards().await;
    assert_eq!(discards[0].operation_id, operation);
    assert_eq!(discards[0].state, "applied");
    assert_eq!(fixture.deletions().await.len(), 1);

    // A second restart changes nothing.
    fixture.restart().await;
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.deletions().await.len(), 1);
    assert_eq!(fixture.discards().await.len(), 1);
}

#[tokio::test]
async fn a_crash_after_the_checkout_was_removed_finishes_the_branch_and_the_row() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    let operation = prepared_discard(&fixture).await;
    // The crash window: Git already released the checkout, but the branch, the
    // row, and the fact never followed.
    git(
        &[
            "worktree",
            "remove",
            "--force",
            &fixture.parent_checkout().display().to_string(),
        ],
        &fixture.repository_root,
    );

    fixture.restart().await;

    assert_eq!(branches(&fixture.repository_root), vec!["main".to_owned()]);
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.discards().await[0].operation_id, operation);
    assert_eq!(fixture.discards().await[0].state, "applied");
    assert_eq!(fixture.deletions().await.len(), 1);
}

#[tokio::test]
async fn a_crash_before_the_prune_leaves_no_stale_administrative_record() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    prepared_discard(&fixture).await;
    // The crash window: the directory is gone but Git's administrative record
    // for it survives, which is the one case a prune is owed.
    std::fs::remove_dir_all(fixture.parent_checkout()).expect("remove the checkout directory");
    assert_eq!(
        registered(&fixture.repository_root).len(),
        2,
        "the stale record is what this restart must clear"
    );

    fixture.restart().await;

    assert_eq!(
        registered(&fixture.repository_root).len(),
        1,
        "only the primary checkout remains registered"
    );
    assert_eq!(branches(&fixture.repository_root), vec!["main".to_owned()]);
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.discards().await[0].state, "applied");
}

#[tokio::test]
async fn a_crash_after_the_branch_deletion_still_deletes_the_row_and_settles_once() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    prepared_discard(&fixture).await;
    // The crash window: every Git step is done and only the bookkeeping is
    // owed.
    git(
        &[
            "worktree",
            "remove",
            "--force",
            &fixture.parent_checkout().display().to_string(),
        ],
        &fixture.repository_root,
    );
    git(&["branch", "-D", PARENT_BRANCH], &fixture.repository_root);

    fixture.restart().await;

    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.discards().await[0].state, "applied");
    assert_eq!(
        fixture.deletions().await.len(),
        1,
        "the settlement publishes exactly one fact"
    );

    fixture.restart().await;
    assert_eq!(fixture.deletions().await.len(), 1);
}

#[tokio::test]
async fn a_crash_after_the_row_was_deleted_adopts_rather_than_removing_again() {
    let mut fixture = fixture().await;
    fixture.create(PARENT_TASK).await;
    prepared_discard(&fixture).await;
    // The crash window nobody can distinguish from outside: the settlement
    // committed and the response was lost. The row is the evidence.
    git(
        &[
            "worktree",
            "remove",
            "--force",
            &fixture.parent_checkout().display().to_string(),
        ],
        &fixture.repository_root,
    );
    git(&["branch", "-D", PARENT_BRANCH], &fixture.repository_root);
    fixture
        .database()
        .await
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "DELETE FROM worktrees".to_owned(),
        ))
        .await
        .expect("delete the index row");

    fixture.restart().await;

    assert_eq!(fixture.discards().await[0].state, "applied");
    assert!(
        fixture.deletions().await.is_empty(),
        "an adopted discard invents no fact for a settlement it did not make"
    );
    // And the ordinary answer afterwards is that there is nothing to discard.
    let discarded = fixture
        .discarded(PARENT_TASK, &uuid::Uuid::new_v4().to_string())
        .await;
    assert_eq!(discarded["removed"], false);
}

/// Journal a prepared discard exactly as the mutation does, and stop there —
/// the durable state a process that died mid-effect leaves behind.
async fn prepared_discard(fixture: &Fixture) -> String {
    let row = fixture
        .rows()
        .await
        .into_iter()
        .find(|row| row.task_id == PARENT_TASK)
        .expect("a created worktree to discard");
    let operation = uuid::Uuid::new_v4().simple().to_string();
    let resource_key = format!("worktree/{PARENT_TASK}");
    let intent = serde_json::json!({
        "kind": "worktree_discard",
        "intentVersion": 1,
        "payload": {
            "worktreeId": row.id,
            "taskId": PARENT_TASK,
            "branch": row.branch,
            "checkoutName": Path::new(&row.path)
                .file_name()
                .expect("a checkout name")
                .to_string_lossy(),
            "repositoryDigest": repository_digest(&fixture.repository_root),
        },
        "resourceKey": resource_key,
        "resourceKind": "worktree",
    });
    let canonical = canonical_json(&intent);
    fixture
        .database()
        .await
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"INSERT INTO workspace_operations
                 (operation_id, kind, intent_version, resource_kind, resource_key,
                  intent, intent_fingerprint, state)
               VALUES (?, 'worktree_discard', 1, 'worktree', ?, ?, ?, 'prepared')"#,
            [
                operation.clone().into(),
                resource_key.into(),
                canonical.clone().into(),
                fingerprint(&canonical).into(),
            ],
        ))
        .await
        .expect("journal a prepared discard");
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

fn public(compact: &str) -> String {
    uuid::Uuid::parse_str(compact)
        .expect("a fixture identity")
        .hyphenated()
        .to_string()
}

// ---------------------------------------------------------------------------
// 5. The public delete surface stays exactly one restricted seam
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_only_public_worktree_delete_is_the_restricted_discard() {
    let sdl = muxed_studio_lib::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build the shipping schema");

    assert!(
        sdl.contains(
            "worktree_discard(task_id: String!, operation_id: String!): WorktreeDiscardResult!"
        ),
        "the restricted discard seam must stay exactly this shape"
    );
    // Nothing in the public contract lets a caller name what to remove.
    for widening in [
        "worktreesDelete",
        "WorktreesDeleteFilter",
        "WorktreesFilterInput!, ",
    ] {
        assert!(
            !sdl.contains(&format!("worktree_discard({widening}")),
            "the discard seam must not accept {widening}"
        );
    }
    assert!(
        !sdl.contains("worktreesDelete"),
        "the generated Worktree delete must stay private"
    );
}
