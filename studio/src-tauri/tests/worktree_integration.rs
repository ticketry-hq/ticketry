//! Landing a completed Work Item's checkout, over real Git.
//!
//! Every case enters where the product does — a committed transition
//! occurrence carrying a Work Item into a completed group — and every assertion
//! is checked against the actual repository on disk, the actual index row, the
//! actual durable journal, and the actual published facts. Nothing here
//! simulates Git, and nothing asks for an integration directly, because nothing
//! in the product can.
//!
//! The starting checkout is built the way creation leaves one behind — a real
//! `git worktree add` and the index row that records it — rather than through
//! the create mutation, because what is under test here is what happens to an
//! existing checkout when its Work Item is completed.
//!
//! The crash cases journal the exact durable state a process that died
//! mid-sequence leaves behind, then reconcile and deliver exactly as a restart
//! does, and assert what convergence did — including that it never merges
//! twice, never resets a ref it did not advance, and never concludes a landing
//! from something merely being missing.

use std::path::{Path, PathBuf};
use std::process::Command;

use muxed_studio_lib::runs_persistence::RunsServices;
use muxed_studio_lib::settings_persistence::ProfileStore;
use muxed_studio_lib::workspace_operations::{self, WorkspaceOperationJournal};
use muxed_studio_lib::worktree_integrate::{
    DeliveryOutcome, IntegrationDelivery, WorktreeIntegrateService, MAX_DELIVERY_BATCH,
};
use muxed_studio_lib::worktree_status::RepositoryLocks;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

const WORKSPACE: &str = "90000000000000000000000000000000";
const PROJECT: &str = "10000000000000000000000000000000";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const BACKLOG: &str = "40000000000000000000000000000001";
const DONE: &str = "40000000000000000000000000000002";
const CANCELLED: &str = "40000000000000000000000000000003";
const MODULE: &str = "20000000000000000000000000000001";
const PARENT_TASK: &str = "60000000000000000000000000000001";
const CHILD_TASK: &str = "60000000000000000000000000000002";

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

/// Git where the answer may legitimately be "there is none".
fn git_output(arguments: &[&str], working_directory: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .output()
        .expect("run git");
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (output.status.success() && !value.is_empty()).then_some(value)
}

/// Git where a non-zero exit is the answer being asked for.
fn git_status(arguments: &[&str], working_directory: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .output()
        .expect("run git")
        .status
        .success()
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent directory");
    }
    std::fs::write(path, contents).expect("write fixture file");
}

/// Commit one file in a checkout and return the new tip.
fn commit(checkout: &Path, name: &str, contents: &str, message: &str) -> String {
    write(&checkout.join(name), contents);
    git(&["add", "."], checkout);
    git(&["commit", "-m", message], checkout);
    git(&["rev-parse", "HEAD"], checkout)
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
        .map(str::to_owned)
        .collect()
}

// ---------------------------------------------------------------------------
// Ticketry fixture
// ---------------------------------------------------------------------------

struct Fixture {
    directory: tempfile::TempDir,
    repository_root: PathBuf,
}

/// One checkout base directory for the whole test process, because the base is
/// a process-wide setting. Fixtures stay isolated by giving every repository a
/// unique name, which is what the checkout path is keyed on.
fn checkout_base() -> &'static Path {
    static BASE: std::sync::OnceLock<tempfile::TempDir> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        let base = tempfile::tempdir().expect("create the shared checkout base");
        std::env::set_var("MUXED_WORKTREES_DIR", base.path());
        base
    })
    .path()
}

fn unique(name: &str) -> String {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let index = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{name}-{index}")
}

/// One journalled operation, as the assertions read it.
struct JournalledOperation {
    operation_id: String,
    kind: String,
    state: String,
    last_error_code: Option<String>,
    evidence: Option<String>,
}

/// One published durable fact.
struct PublishedFact {
    event_kind: String,
    work_item_id: Option<String>,
    payload: serde_json::Value,
}

impl Fixture {
    fn checkout(&self, name: &str) -> PathBuf {
        checkout_base()
            .join(
                self.repository_root
                    .file_name()
                    .expect("a repository directory name"),
            )
            .join(name)
    }

    /// The one checkout every case in this file works with.
    fn task_checkout(&self) -> PathBuf {
        self.checkout("CODIN-881-parent-story")
    }

    /// The repository as resolution reaches it: Git's own toplevel, canonical.
    /// The journalled repository identity is a digest of exactly this, so a
    /// fixture that spelled the path differently would look like a repointed
    /// module rather than the same repository.
    fn canonical_repository(&self) -> PathBuf {
        self.repository_root
            .canonicalize()
            .expect("canonicalize the fixture repository")
    }

    async fn database(&self) -> DatabaseConnection {
        Database::connect(format!(
            "sqlite:{}?mode=rwc",
            self.directory.path().join("state.db").display()
        ))
        .await
        .expect("open the fixture store")
    }

    /// The integration capability, composed exactly as the runtime composes it.
    async fn integrations(&self) -> WorktreeIntegrateService {
        let database = self.database().await;
        WorktreeIntegrateService::new(
            database.clone(),
            ProfileStore::new(self.directory.path().join("profiles.json")),
            WorkspaceOperationJournal::new(database.clone()),
            Some(
                RunsServices::new(database.clone())
                    .outbox()
                    .events()
                    .clone(),
            ),
            RepositoryLocks::shared(),
        )
    }

    async fn deliver(&self) -> Vec<IntegrationDelivery> {
        self.integrations()
            .await
            .deliver_pending(MAX_DELIVERY_BATCH)
            .await
            .expect("deliver the committed completions")
    }

    /// Deliver and assert exactly one occurrence was acted on.
    async fn delivered_one(&self) -> IntegrationDelivery {
        let delivered = self.deliver().await;
        assert_eq!(delivered.len(), 1, "{delivered:?}");
        delivered.into_iter().next().expect("one delivery")
    }

    /// The parent story's checkout, exactly as creation leaves it: the branch
    /// cut from the repository's committed HEAD, the checkout registered with
    /// Git, and the index row recording the base it must land back into.
    async fn create_worktree(&self) -> PathBuf {
        let base_commit = git(&["rev-parse", "HEAD"], &self.repository_root);
        // A detached repository records its commit as the integration target,
        // which is exactly what creation records.
        let base_branch = match git_output(
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
            &self.repository_root,
        ) {
            Some(branch) => branch,
            None => base_commit.clone(),
        };
        let checkout = self.task_checkout();
        std::fs::create_dir_all(checkout.parent().expect("a checkout base"))
            .expect("create the checkout base");
        git(
            &[
                "worktree",
                "add",
                "-b",
                "wt/CODIN-881-parent-story",
                &checkout.display().to_string(),
                &base_commit,
            ],
            &self.repository_root,
        );
        self.database()
            .await
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                r#"INSERT INTO worktrees
                     (id, task_id, workspace_slug, project_id, module_id, ticket_seq,
                      repo_root, path, branch, base_branch, base_commit, status,
                      ephemeral, created_at, updated_at)
                   VALUES (?, ?, 'meml', ?, ?, 881, ?, ?, 'wt/CODIN-881-parent-story',
                           ?, ?, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"#,
                [
                    uuid::Uuid::new_v4().simple().to_string().into(),
                    PARENT_TASK.into(),
                    PROJECT.into(),
                    MODULE.into(),
                    self.repository_root.display().to_string().into(),
                    checkout.display().to_string().into(),
                    base_branch.into(),
                    base_commit.into(),
                ],
            ))
            .await
            .expect("index the created checkout");
        checkout
    }

    /// Journal the durable row a committed workflow transition writes. This is
    /// the only way an integration is ever asked for.
    async fn transition(&self, task_id: &str, to_state: &str, to_group: &str) -> String {
        let occurrence = uuid::Uuid::new_v4().simple().to_string();
        self.database()
            .await
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                r#"INSERT INTO worktracker_transitionoccurrence
                     (occurrence_id, version, issue_id, project_id, issue_type_id,
                      from_state_id, to_state_id, from_group, to_group,
                      work_item_revision, workflow_revision, destination_auto_start,
                      committed_at)
                   VALUES (?, 1, ?, ?, ?, ?, ?, 'started', ?, 1, 1, 0, CURRENT_TIMESTAMP)"#,
                [
                    occurrence.clone().into(),
                    task_id.into(),
                    PROJECT.into(),
                    TASK_TYPE.into(),
                    BACKLOG.into(),
                    to_state.into(),
                    to_group.into(),
                ],
            ))
            .await
            .expect("journal a committed transition");
        occurrence
    }

    async fn complete(&self, task_id: &str) -> String {
        self.transition(task_id, DONE, "completed").await
    }

    async fn rows(&self) -> Vec<(String, String)> {
        rows(
            &self.database().await,
            "SELECT task_id, status FROM worktrees ORDER BY task_id",
        )
        .await
        .into_iter()
        .map(|row| (text(&row, 0), text(&row, 1)))
        .collect()
    }

    async fn operations(&self) -> Vec<JournalledOperation> {
        rows(
            &self.database().await,
            "SELECT operation_id, kind, state, last_error_code, evidence FROM workspace_operations
             ORDER BY created_at, operation_id",
        )
        .await
        .into_iter()
        .map(|row| JournalledOperation {
            operation_id: text(&row, 0),
            kind: text(&row, 1),
            state: text(&row, 2),
            last_error_code: optional_text(&row, 3),
            evidence: optional_text(&row, 4),
        })
        .collect()
    }

    async fn integration(&self) -> JournalledOperation {
        let mut operations = self.operations().await;
        operations.retain(|operation| operation.kind == "worktree_integrate");
        assert_eq!(operations.len(), 1, "exactly one integration is journalled");
        operations.pop().expect("the integration operation")
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

    /// Journal a prepared integration and stop there — the durable state a
    /// process that died mid-sequence leaves behind. `checkpoint` is the Git
    /// evidence it had already recorded.
    async fn prepared_integration(
        &self,
        occurrence: &str,
        base_ref: &str,
        checkpoint: Option<serde_json::Value>,
    ) -> String {
        let operation = derived_operation_id(PARENT_TASK, occurrence);
        let intent = serde_json::json!({
            "kind": "worktree_integrate",
            "intentVersion": 1,
            "payload": {
                "baseRef": base_ref,
                "branch": "wt/CODIN-881-parent-story",
                "checkoutName": "CODIN-881-parent-story",
                "occurrenceId": occurrence,
                "repositoryDigest": repository_digest(&self.canonical_repository()),
                "taskId": PARENT_TASK,
            },
            "resourceKey": format!("worktree/{PARENT_TASK}"),
            "resourceKind": "worktree",
        });
        let canonical = canonical_json(&intent);
        let evidence = checkpoint
            .map(|checkpoint| serde_json::json!({ "checkpoint": checkpoint }).to_string());
        self.database()
            .await
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                r#"INSERT INTO workspace_operations
                     (operation_id, kind, intent_version, resource_kind, resource_key,
                      intent, intent_fingerprint, state, evidence)
                   VALUES (?, 'worktree_integrate', 1, 'worktree', ?, ?, ?, 'prepared', ?)"#,
                [
                    operation.clone().into(),
                    format!("worktree/{PARENT_TASK}").into(),
                    canonical.clone().into(),
                    fingerprint(&canonical).into(),
                    evidence.into(),
                ],
            ))
            .await
            .expect("journal a prepared integration");
        operation
    }

    /// What a restart does over the very same data directory: one bounded
    /// reconciliation pass over the operations a previous process abandoned,
    /// then one bounded delivery pass over the completions nobody answered.
    async fn restart(&mut self) {
        let integrations = self.integrations().await;
        integrations
            .reconciler()
            .reconcile()
            .await
            .expect("reconcile abandoned integrations");
        integrations
            .deliver_pending(MAX_DELIVERY_BATCH)
            .await
            .expect("deliver the committed completions");
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

/// Install the durable journal this capability records its evidence in, exactly
/// as composition installs it.
async fn install(database: &DatabaseConnection) {
    workspace_operations::schema::install(database)
        .await
        .expect("install the Workspace Operation journal");
}

/// One module over one real repository, a parent story with a child, the
/// transition-occurrence ledger completions are committed to, and the durable
/// outbox the facts land in.
async fn fixture() -> Fixture {
    checkout_base();
    let directory = tempfile::tempdir().expect("create the integration fixture directory");
    let repository_root = directory
        .path()
        .join("repositories")
        .join(unique("ticketry"));
    repository(&repository_root);

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
            CREATE TABLE worktracker_workspace (
                id char(32) PRIMARY KEY, slug varchar(255) NOT NULL UNIQUE,
                name varchar(255) NOT NULL, created_at datetime NOT NULL,
                updated_at datetime NOT NULL, onboarding_required bool NOT NULL
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
            CREATE TABLE worktracker_transitionoccurrence (
                occurrence_id char(32) PRIMARY KEY, version integer NOT NULL,
                issue_id char(32) NOT NULL, project_id char(32) NOT NULL,
                issue_type_id char(32) NOT NULL, from_state_id char(32) NOT NULL,
                to_state_id char(32) NOT NULL, from_group varchar(32) NOT NULL,
                to_group varchar(32) NOT NULL, work_item_revision bigint NOT NULL,
                workflow_revision integer NOT NULL, destination_auto_start bool NOT NULL,
                run_now_decision_id char(32),
                committed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE runs_status_events (
                cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
                project_id TEXT NOT NULL, event_kind TEXT NOT NULL,
                payload_version INTEGER NOT NULL, subject_kind TEXT NOT NULL,
                subject_id TEXT NOT NULL, agent_run_id TEXT, automation_attempt_id TEXT,
                work_item_id TEXT, payload TEXT NOT NULL,
                committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO worktracker_workspace VALUES
                ('{WORKSPACE}', 'meml', 'Memory Lane', CURRENT_TIMESTAMP,
                 CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', '{WORKSPACE}', 'Coding', 'CODIN', '', 900, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_state VALUES
                ('{BACKLOG}', '{PROJECT}', 'Backlog', 'backlog', '', 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{DONE}', '{PROJECT}', 'Done', 'completed', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CANCELLED}', '{PROJECT}', 'Cancelled', 'cancelled', '', 2, 0,
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
                ('{PARENT_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{MODULE}',
                 '{MODULE}', '{BACKLOG}', 1, 'Parent story', 881, 0, 'z', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{CHILD_TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', '{PARENT_TASK}',
                 '{MODULE}', '{BACKLOG}', 1, 'Child task', 882, 0, 'za', '',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the worktree integration fixture");
    install(&writer).await;
    drop(writer);

    write(
        &directory.path().join("profiles.json"),
        &serde_json::json!({
            "recent_profile_index": 0,
            "profiles": [{
                "name": "Local",
                "workspace_slug": "meml",
                "module_links": [
                    { "module_id": MODULE, "path": repository_root.display().to_string() }
                ]
            }]
        })
        .to_string(),
    );

    Fixture {
        directory,
        repository_root,
    }
}

// ---------------------------------------------------------------------------
// 1. Only a committed top-level completion starts an integration
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_completed_story_lands_its_checkout_into_the_checked_out_base() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    let landed = commit(&checkout, "feature.txt", "work\n", "task work");
    fixture.complete(PARENT_TASK).await;

    let delivery = fixture.delivered_one().await;

    assert_eq!(delivery.outcome, DeliveryOutcome::Integrated);
    // Git is the authority for what landed.
    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed,
        "the recorded base fast-forwards onto the merged branch"
    );
    assert!(!checkout.exists(), "the landed checkout is removed");
    assert!(
        !branches(&fixture.repository_root)
            .iter()
            .any(|branch| branch.starts_with("wt/")),
        "the merged task branch is deleted"
    );
    assert!(fixture.rows().await.is_empty(), "the index row is removed");

    let operation = fixture.integration().await;
    assert_eq!(operation.operation_id, delivery.operation_id);
    assert_eq!(operation.state, "applied");
    assert!(operation
        .evidence
        .as_deref()
        .expect("settled evidence")
        .contains(&landed));

    let deleted = fixture
        .facts()
        .await
        .into_iter()
        .filter(|fact| fact.event_kind == "worktree.deleted")
        .collect::<Vec<_>>();
    assert_eq!(deleted.len(), 1, "exactly one deletion fact is settled");
    assert_eq!(deleted[0].work_item_id.as_deref(), Some(PARENT_TASK));
    assert_eq!(deleted[0].payload["changeKind"], "integrated");
    assert_eq!(deleted[0].payload["removed"], true);
}

#[tokio::test]
async fn a_base_that_is_not_checked_out_is_moved_to_the_merged_tip() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    let landed = commit(&checkout, "feature.txt", "work\n", "task work");
    // The primary checkout is somewhere else entirely, so the base can only be
    // moved as a ref.
    git(&["checkout", "-b", "elsewhere"], &fixture.repository_root);
    fixture.complete(PARENT_TASK).await;

    assert_eq!(
        fixture.delivered_one().await.outcome,
        DeliveryOutcome::Integrated
    );

    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed
    );
    assert_eq!(
        git(
            &["rev-parse", "--abbrev-ref", "HEAD"],
            &fixture.repository_root
        ),
        "elsewhere",
        "the primary checkout is left exactly where it was"
    );
    assert!(!checkout.exists());
    assert!(fixture.rows().await.is_empty());
}

#[tokio::test]
async fn completing_a_child_lands_nothing() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");

    // The child shares its parent's checkout without owning it.
    fixture.complete(CHILD_TASK).await;

    assert!(fixture.deliver().await.is_empty());
    assert!(checkout.exists());
    assert_eq!(fixture.rows().await.len(), 1);
    assert!(fixture
        .operations()
        .await
        .iter()
        .all(|operation| operation.kind != "worktree_integrate"));
}

#[tokio::test]
async fn cancelling_a_story_lands_nothing() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");

    fixture
        .transition(PARENT_TASK, CANCELLED, "cancelled")
        .await;

    assert!(fixture.deliver().await.is_empty());
    assert!(
        checkout.exists(),
        "a cancelled Work Item's checkout is left for a person to discard"
    );
    assert_eq!(fixture.rows().await.len(), 1);
}

#[tokio::test]
async fn delivering_the_same_completion_twice_returns_the_same_operation() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");
    let occurrence = fixture.complete(PARENT_TASK).await;

    let first = fixture.delivered_one().await;
    let second = fixture
        .integrations()
        .await
        .deliver(&occurrence)
        .await
        .expect("re-deliver the same completion")
        .expect("the same durable operation");

    assert_eq!(first.outcome, DeliveryOutcome::Integrated);
    assert_eq!(
        second.outcome,
        DeliveryOutcome::Replayed {
            state: "applied".to_owned()
        },
        "a re-delivered occurrence replays its durable operation"
    );
    assert_eq!(first.operation_id, second.operation_id);
    assert!(
        fixture.deliver().await.is_empty(),
        "the landed checkout leaves the scan nothing to reconsider"
    );
    fixture.integration().await;
    assert_eq!(
        fixture
            .facts()
            .await
            .iter()
            .filter(|fact| fact.event_kind == "worktree.deleted")
            .count(),
        1,
        "no second deletion fact"
    );
}

// ---------------------------------------------------------------------------
// 2. Refusals protect work rather than forcing it
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_dirty_checkout_refuses_integration_without_losing_work() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    let committed = commit(&checkout, "feature.txt", "work\n", "task work");
    write(&checkout.join("feature.txt"), "uncommitted\n");
    fixture.complete(PARENT_TASK).await;

    let delivery = fixture.delivered_one().await;

    assert_eq!(
        delivery.outcome,
        DeliveryOutcome::Refused {
            code: "worktree_dirty".to_owned()
        }
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("feature.txt")).expect("read the working file"),
        "uncommitted\n",
        "uncommitted work is untouched"
    );
    assert_eq!(
        git(
            &["rev-parse", "wt/CODIN-881-parent-story"],
            &fixture.repository_root
        ),
        committed,
        "nothing was merged"
    );
    assert_eq!(fixture.rows().await.len(), 1);
    assert_eq!(fixture.integration().await.state, "failed");
}

#[tokio::test]
async fn an_ephemeral_checkout_is_never_landed() {
    let fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");
    // Scratch checkouts are discard-only wherever they come from.
    fixture
        .database()
        .await
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE worktrees SET ephemeral = 1".to_owned(),
        ))
        .await
        .expect("mark the checkout ephemeral");
    fixture.complete(PARENT_TASK).await;

    assert_eq!(
        fixture.delivered_one().await.outcome,
        DeliveryOutcome::Refused {
            code: "worktree_ephemeral".to_owned()
        }
    );
    assert!(checkout.exists());
    assert_eq!(fixture.rows().await.len(), 1);
}

#[tokio::test]
async fn a_detached_base_is_refused_rather_than_turned_into_a_ref() {
    let fixture = fixture().await;
    // A repository with no named HEAD records its commit as the base, so there
    // is no branch to advance when the Work Item completes.
    git(&["checkout", "--detach"], &fixture.repository_root);
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");
    fixture.complete(PARENT_TASK).await;

    let delivery = fixture.delivered_one().await;

    assert_eq!(
        delivery.outcome,
        DeliveryOutcome::Conflicted {
            code: "worktree_base_ref_missing".to_owned()
        }
    );
    assert_eq!(
        branches(&fixture.repository_root)
            .iter()
            .filter(|branch| branch.starts_with("wt/"))
            .count(),
        1,
        "the task branch survives, so nothing is lost"
    );
    assert!(checkout.exists());
    assert_eq!(fixture.rows().await.len(), 1);
    let operation = fixture.integration().await;
    assert_eq!(operation.state, "conflicted");
    assert_eq!(
        operation.last_error_code.as_deref(),
        Some("worktree_base_ref_missing")
    );
}

// ---------------------------------------------------------------------------
// 3. A conflict stays inside the isolated checkout
// ---------------------------------------------------------------------------

/// A base and a task branch that changed the same line.
async fn diverged(fixture: &Fixture) -> PathBuf {
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "README.md", "task side\n", "task edit");
    commit(
        &fixture.repository_root,
        "README.md",
        "base side\n",
        "base edit",
    );
    checkout
}

#[tokio::test]
async fn a_merge_conflict_stays_inside_the_task_checkout() {
    let fixture = fixture().await;
    let checkout = diverged(&fixture).await;
    let primary_head = git(&["rev-parse", "HEAD"], &fixture.repository_root);
    fixture.complete(PARENT_TASK).await;

    let delivery = fixture.delivered_one().await;

    assert_eq!(
        delivery.outcome,
        DeliveryOutcome::Conflicted {
            code: "worktree_merge_conflict".to_owned()
        }
    );
    // The primary checkout was never part of the merge.
    assert_eq!(
        git(&["rev-parse", "HEAD"], &fixture.repository_root),
        primary_head
    );
    assert!(
        !fixture.repository_root.join(".git/MERGE_HEAD").exists(),
        "the primary checkout never holds an unresolved merge"
    );
    assert!(
        !git(&["diff", "--name-only", "--diff-filter=U"], &checkout).is_empty(),
        "the unresolved merge is left in the isolated checkout"
    );
    assert_eq!(
        fixture.rows().await,
        vec![(PARENT_TASK.to_owned(), "conflict".to_owned())],
        "the conflict is recorded on the index row"
    );
    let conflict = fixture
        .facts()
        .await
        .into_iter()
        .find(|fact| fact.payload["changeKind"] == "conflicted")
        .expect("a published conflict fact");
    assert_eq!(conflict.event_kind, "worktree.changed");
    assert_eq!(conflict.payload["state"], "conflict");
}

#[tokio::test]
async fn a_committed_resolution_lands_on_the_next_completion() {
    let fixture = fixture().await;
    let checkout = diverged(&fixture).await;
    fixture.complete(PARENT_TASK).await;
    assert_eq!(
        fixture.delivered_one().await.outcome,
        DeliveryOutcome::Conflicted {
            code: "worktree_merge_conflict".to_owned()
        }
    );

    // The person resolves the conflict in the worktree and commits it, then
    // marks the Work Item complete again.
    write(&checkout.join("README.md"), "resolved\n");
    git(&["add", "."], &checkout);
    git(&["commit", "--no-edit"], &checkout);
    let resolved = git(&["rev-parse", "HEAD"], &checkout);
    fixture.complete(PARENT_TASK).await;

    let delivered = fixture.deliver().await;

    assert_eq!(delivered.len(), 2, "{delivered:?}");
    let outcomes = delivered
        .iter()
        .map(|delivery| delivery.outcome.clone())
        .collect::<Vec<_>>();
    assert!(
        outcomes.contains(&DeliveryOutcome::Integrated),
        "the new completion lands the resolved merge: {outcomes:?}"
    );
    assert!(
        outcomes.contains(&DeliveryOutcome::Replayed {
            state: "conflicted".to_owned()
        }),
        "the first completion keeps its durable outcome: {outcomes:?}"
    );
    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        resolved
    );
    assert!(!checkout.exists());
    assert!(fixture.rows().await.is_empty());
}

// ---------------------------------------------------------------------------
// 4. Crash boundaries converge on restart
// ---------------------------------------------------------------------------

/// The world after Git already merged the base into the task checkout, with the
/// operation still open. Returns the checkout and the merged tip.
async fn merged_but_unsettled(fixture: &Fixture) -> (PathBuf, String, String) {
    let checkout = fixture.create_worktree().await;
    commit(&checkout, "feature.txt", "work\n", "task work");
    commit(&fixture.repository_root, "other.txt", "base\n", "base work");
    let occurrence = fixture.complete(PARENT_TASK).await;
    git(&["merge", "--no-edit", "main"], &checkout);
    let landed = git(&["rev-parse", "HEAD"], &checkout);
    (checkout, landed, occurrence)
}

#[tokio::test]
async fn a_merge_that_already_happened_is_never_merged_again() {
    let mut fixture = fixture().await;
    let (checkout, landed, occurrence) = merged_but_unsettled(&fixture).await;
    let operation = fixture
        .prepared_integration(&occurrence, "main", None)
        .await;

    fixture.restart().await;

    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed
    );
    assert!(!checkout.exists());
    assert!(fixture.rows().await.is_empty());
    let settled = fixture.integration().await;
    assert_eq!(settled.operation_id, operation);
    assert_eq!(settled.state, "applied");
    // A second merge would have produced a commit with two parents on top of
    // the one already recorded.
    assert_eq!(
        git(&["rev-list", "--count", "main"], &fixture.repository_root),
        git(&["rev-list", "--count", &landed], &fixture.repository_root),
        "no second merge commit is created"
    );

    fixture.restart().await;
    assert!(fixture.rows().await.is_empty());
    assert_eq!(
        fixture
            .facts()
            .await
            .iter()
            .filter(|fact| fact.event_kind == "worktree.deleted")
            .count(),
        1
    );
}

#[tokio::test]
async fn an_interrupted_base_advance_is_completed_rather_than_repeated() {
    let mut fixture = fixture().await;
    let (checkout, landed, occurrence) = merged_but_unsettled(&fixture).await;
    // The crash window: the base already points at the merged tip.
    git(
        &["merge", "--ff-only", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );
    fixture
        .prepared_integration(&occurrence, "main", None)
        .await;

    fixture.restart().await;

    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed
    );
    assert!(!checkout.exists());
    assert!(!branches(&fixture.repository_root)
        .iter()
        .any(|branch| branch.starts_with("wt/")));
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.integration().await.state, "applied");
}

#[tokio::test]
async fn an_interrupted_checkout_removal_is_completed() {
    let mut fixture = fixture().await;
    let (checkout, landed, occurrence) = merged_but_unsettled(&fixture).await;
    git(
        &["merge", "--ff-only", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );
    git(
        &["worktree", "remove", &checkout.display().to_string()],
        &fixture.repository_root,
    );
    fixture
        .prepared_integration(&occurrence, "main", None)
        .await;

    fixture.restart().await;

    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed
    );
    assert!(!branches(&fixture.repository_root)
        .iter()
        .any(|branch| branch.starts_with("wt/")));
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.integration().await.state, "applied");
}

#[tokio::test]
async fn a_deleted_branch_is_completed_only_from_its_recorded_evidence() {
    let mut fixture = fixture().await;
    let (checkout, landed, occurrence) = merged_but_unsettled(&fixture).await;
    git(
        &["merge", "--ff-only", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );
    git(
        &["worktree", "remove", &checkout.display().to_string()],
        &fixture.repository_root,
    );
    git(
        &["branch", "-d", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );
    // The evidence the executor records before it deletes the branch is the
    // only thing that can prove what landed.
    fixture
        .prepared_integration(
            &occurrence,
            "main",
            Some(serde_json::json!({ "merged": true, "landedCommit": landed })),
        )
        .await;

    fixture.restart().await;

    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.integration().await.state, "applied");
    assert_eq!(
        fixture
            .facts()
            .await
            .iter()
            .filter(|fact| fact.event_kind == "worktree.deleted")
            .count(),
        1
    );

    fixture.restart().await;
    assert_eq!(fixture.integration().await.state, "applied");
}

#[tokio::test]
async fn a_missing_branch_and_row_are_never_read_as_a_successful_landing() {
    let mut fixture = fixture().await;
    let (checkout, _, occurrence) = merged_but_unsettled(&fixture).await;
    // Everything the landing would have removed is gone, but the base never
    // advanced and nothing recorded what the branch contained.
    git(
        &[
            "worktree",
            "remove",
            "--force",
            &checkout.display().to_string(),
        ],
        &fixture.repository_root,
    );
    git(
        &["branch", "-D", "wt/CODIN-881-parent-story"],
        &fixture.repository_root,
    );
    fixture
        .prepared_integration(&occurrence, "main", None)
        .await;

    fixture.restart().await;

    let operation = fixture.integration().await;
    assert_eq!(operation.state, "conflicted");
    assert_eq!(
        operation.last_error_code.as_deref(),
        Some("worktree_branch_absent")
    );
    assert_eq!(
        fixture.rows().await.len(),
        1,
        "the index row is retained as evidence rather than removed on a guess"
    );
    assert!(fixture
        .facts()
        .await
        .iter()
        .all(|fact| fact.event_kind != "worktree.deleted"));
}

#[tokio::test]
async fn a_settled_landing_is_untouched_by_a_second_restart() {
    let mut fixture = fixture().await;
    let checkout = fixture.create_worktree().await;
    let landed = commit(&checkout, "feature.txt", "work\n", "task work");
    fixture.complete(PARENT_TASK).await;
    assert_eq!(
        fixture.delivered_one().await.outcome,
        DeliveryOutcome::Integrated
    );

    fixture.restart().await;
    fixture.restart().await;

    assert_eq!(
        git(&["rev-parse", "main"], &fixture.repository_root),
        landed
    );
    assert!(fixture.rows().await.is_empty());
    assert_eq!(fixture.integration().await.state, "applied");
    assert_eq!(
        fixture
            .facts()
            .await
            .iter()
            .filter(|fact| fact.event_kind == "worktree.deleted")
            .count(),
        1,
        "settlement publishes exactly one deletion fact, ever"
    );
    assert!(
        !git_status(
            &[
                "rev-parse",
                "--verify",
                "refs/heads/wt/CODIN-881-parent-story"
            ],
            &fixture.repository_root
        ),
        "the task branch stays deleted"
    );
}

// ---------------------------------------------------------------------------
// The durable identities this file depends on, spelled out so a change to
// either contract fails here rather than silently orphaning journalled rows.
// ---------------------------------------------------------------------------

/// The operation identity derived from one Work Item and one completion
/// occurrence.
fn derived_operation_id(task_id: &str, occurrence_id: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(b"worktree-integrate:");
    hasher.update(task_id.as_bytes());
    hasher.update(b":");
    hasher.update(occurrence_id.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).simple().to_string()
}

fn repository_digest(repository: &Path) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(repository.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
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
