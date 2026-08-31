//! Live document discovery and the durable facts it publishes.
//!
//! Every case enters through a public seam — the watcher supervisor the desktop
//! composes, or the Documents application service GraphQL calls — and asserts
//! on the authoritative registry and the durable outbox. Nothing here pins a
//! private helper, a task schedule, or an event ordering the operating system
//! does not guarantee.
//!
//! The filesystem event source is supplied rather than real. A kernel queue
//! cannot be made to overflow on demand and a platform watch cannot be made to
//! fail on demand, so a recovery path driven only by real notifications would be
//! a recovery path that is never exercised.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use muxed_studio_lib::documents::watch::filesystem_events::{
    DirectoryWatch, FilesystemEvent, FilesystemWatcher, WatchUnavailable,
};
use muxed_studio_lib::documents::watch::DocumentWatchSupervisor;
use muxed_studio_lib::documents::{DocumentFactRecorder, DocumentsService, TaskRegistryScope};
use muxed_studio_lib::runs_persistence::RunsServices;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tokio::sync::mpsc;

const PROJECT: &str = "11111111111111111111111111111111";
const PUBLIC_PROJECT: &str = "11111111-1111-1111-1111-111111111111";
const MODULE: &str = "44444444444444444444444444444444";
const PUBLIC_MODULE: &str = "44444444-4444-4444-4444-444444444444";
const TASK: &str = "33333333333333333333333333333333";
const PUBLIC_TASK: &str = "33333333-3333-3333-3333-333333333333";

/// A test window short enough that a case does not sleep for a third of a
/// second per settlement, long enough that a burst still folds.
const WINDOW: Duration = Duration::from_millis(20);

// ---------------------------------------------------------------- event source

/// A filesystem event source a test drives directly.
#[derive(Clone, Default)]
struct ScriptedWatcher {
    senders: Arc<Mutex<Vec<mpsc::UnboundedSender<FilesystemEvent>>>>,
    /// Roots the source refuses to watch at all.
    unwatchable: Arc<Mutex<Vec<PathBuf>>>,
    started: Arc<Mutex<Vec<PathBuf>>>,
}

struct ScriptedWatch(mpsc::UnboundedReceiver<FilesystemEvent>);

impl DirectoryWatch for ScriptedWatch {
    fn events(&mut self) -> &mut mpsc::UnboundedReceiver<FilesystemEvent> {
        &mut self.0
    }
}

impl FilesystemWatcher for ScriptedWatcher {
    fn watch(&self, root: &Path) -> Result<Box<dyn DirectoryWatch>, WatchUnavailable> {
        if self
            .unwatchable
            .lock()
            .unwrap()
            .iter()
            .any(|denied| denied == root)
        {
            return Err(WatchUnavailable);
        }
        let (sender, receiver) = mpsc::unbounded_channel();
        self.senders.lock().unwrap().push(sender);
        self.started.lock().unwrap().push(root.to_path_buf());
        Ok(Box::new(ScriptedWatch(receiver)))
    }
}

impl ScriptedWatcher {
    fn publish(&self, event: FilesystemEvent) {
        for sender in self.senders.lock().unwrap().iter() {
            let _ = sender.send(event.clone());
        }
    }

    fn started_roots(&self) -> Vec<PathBuf> {
        self.started.lock().unwrap().clone()
    }

    /// End every live stream, as a platform watcher does when its handle dies.
    fn close(&self) {
        self.senders.lock().unwrap().clear();
    }
}

// -------------------------------------------------------------------- fixture

struct Fixture {
    directory: tempfile::TempDir,
    database: DatabaseConnection,
}

impl Fixture {
    fn path(&self) -> &Path {
        self.directory.path()
    }

    fn documents(&self) -> DocumentsService {
        DocumentsService::new(self.database.clone()).publishing(Some(DocumentFactRecorder::new(
            RunsServices::new(self.database.clone())
                .outbox()
                .events()
                .clone(),
        )))
    }

    /// Link the module to a real local folder, which is where an authorized
    /// root is resolved from.
    async fn link_module(&self) {
        muxed_studio_lib::module_links::schema::install(&self.database)
            .await
            .expect("install the Module Link schema");
        muxed_studio_lib::module_links::ModuleLinkStore::new(self.database.clone())
            .set(
                PUBLIC_MODULE,
                &self.path().join("checkout").to_string_lossy(),
            )
            .await
            .expect("link the fixture module");
    }

    /// The registry rows for the task bucket, without reconciling anything.
    async fn registered(&self) -> Vec<String> {
        rows(
            &self.database,
            "SELECT rel_path FROM design_documents ORDER BY rel_path",
        )
        .await
    }

    /// Every durable document fact in the outbox, as `kind rel_path`.
    async fn facts(&self) -> Vec<String> {
        rows(
            &self.database,
            "SELECT event_kind || ' ' || json_extract(payload, '$.relPath')
             FROM runs_status_events
             WHERE event_kind IN ('document.changed', 'document.deleted')
             ORDER BY cursor",
        )
        .await
    }

    async fn fact_projects(&self) -> Vec<String> {
        rows(
            &self.database,
            "SELECT DISTINCT project_id FROM runs_status_events
             WHERE event_kind LIKE 'document.%'",
        )
        .await
    }

    async fn fact_payloads(&self) -> Vec<String> {
        rows(
            &self.database,
            "SELECT payload FROM runs_status_events
             WHERE event_kind LIKE 'document.%' ORDER BY cursor",
        )
        .await
    }
}

async fn rows(database: &DatabaseConnection, sql: &str) -> Vec<String> {
    use sea_orm::{DbBackend, Statement};

    database
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .expect("read the fixture database")
        .into_iter()
        .map(|row| row.try_get_by_index::<String>(0).expect("a text column"))
        .collect()
}

/// A state.db carrying the adopted Documents shape, the durable outbox, and
/// enough WorkTracker scope to resolve one project.
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create a document-watch fixture directory");
    let database = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open the fixture database");
    database
        .execute_unprepared(&format!(
            r#"
        PRAGMA journal_mode=WAL;
        CREATE TABLE design_documents (
            id VARCHAR NOT NULL, module_id VARCHAR NOT NULL, task_id VARCHAR NOT NULL,
            scope VARCHAR NOT NULL, root_dir VARCHAR NOT NULL, rel_path VARCHAR NOT NULL,
            discovered_by_run_id VARCHAR, created_at VARCHAR NOT NULL,
            updated_at VARCHAR NOT NULL, content_digest VARCHAR,
            PRIMARY KEY (id), CONSTRAINT uq_design_doc_path UNIQUE (root_dir, rel_path)
        );
        CREATE TABLE worktracker_issue (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
            issue_type_id TEXT NOT NULL DEFAULT '', parent_id TEXT, module_id TEXT,
            state_id TEXT, state_revision INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL DEFAULT '', sequence_id INTEGER NOT NULL DEFAULT 0,
            is_archived BOOLEAN NOT NULL DEFAULT 0, rank TEXT NOT NULL DEFAULT 'a',
            description TEXT NOT NULL DEFAULT '',
            workspace_tab_order JSON NOT NULL DEFAULT '[]',
            created_at DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00',
            updated_at DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00'
        );
        CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT NOT NULL,
            status TEXT NOT NULL, started_at TEXT NOT NULL,
            ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
            lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
            scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT, initial_prompt TEXT,
            launch_reasoning TEXT, launch_unattended BOOL NOT NULL DEFAULT 0
        );
        CREATE TABLE runs_status_events (
            cursor integer PRIMARY KEY AUTOINCREMENT,
            event_id char(32) NOT NULL UNIQUE,
            project_id char(32) NOT NULL,
            event_kind varchar(64) NOT NULL,
            payload_version integer NOT NULL CHECK (payload_version > 0),
            subject_kind varchar(64) NOT NULL,
            subject_id varchar(255) NOT NULL,
            agent_run_id varchar(255) NULL,
            automation_attempt_id char(32) NULL,
            work_item_id char(32) NULL,
            payload text NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
            committed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO worktracker_issue (id, project_id, type, module_id, name, sequence_id) VALUES
            ('{MODULE}','{PROJECT}','module',NULL,'Platform Runtime',12),
            ('{TASK}','{PROJECT}','task','{MODULE}','Restore live document discovery',759);
    "#
        ))
        .await
        .expect("create the document-watch fixture schema");
    let fixture = Fixture {
        directory,
        database,
    };
    fixture.link_module().await;
    fixture
}

fn write(root: &Path, relative: &str, body: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().expect("a parent directory"))
        .expect("create the parent directory");
    std::fs::write(path, body).expect("write the document");
}

fn design_dir(fixture: &Fixture) -> PathBuf {
    fixture
        .path()
        .join("checkout/spec/platform-runtime--44444444/T759--restore-live-document-discovery")
}

async fn register_run(fixture: &Fixture, id: &str, scope: &str, status: &str, design_dir: &Path) {
    fixture
        .database
        .execute_unprepared(&format!(
            r#"INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope, design_dir)
               VALUES ('{id}', '{TASK}', 'codex', '{status}', '2026-01-01T00:00:00Z',
                       '{scope}', '{}')"#,
            design_dir.to_string_lossy()
        ))
        .await
        .expect("register the Agent Run");
}

async fn terminate_run(fixture: &Fixture, id: &str) {
    fixture
        .database
        .execute_unprepared(&format!(
            "UPDATE agent_runs SET status = 'exited' WHERE id = '{id}'"
        ))
        .await
        .expect("terminate the Agent Run");
}

fn supervisor(fixture: &Fixture, watcher: &ScriptedWatcher) -> DocumentWatchSupervisor {
    DocumentWatchSupervisor::with_watcher(&fixture.documents(), Arc::new(watcher.clone()), WINDOW)
}

/// Wait until `condition` holds, or fail. Watchers are background tasks, so a
/// case observes their effect rather than their schedule.
async fn eventually<F, Fut>(what: &str, mut condition: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for _ in 0..200 {
        if condition().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("{what} did not happen");
}

// ---------------------------------------------------------------------- cases

#[tokio::test]
async fn an_active_run_gets_exactly_one_watcher_however_often_supervision_runs() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);

    for _ in 0..3 {
        supervisor.reconcile().await.expect("reconcile watchers");
    }

    assert_eq!(supervisor.live_count(), 1);
    assert_eq!(watcher.started_roots().len(), 1);
}

#[tokio::test]
async fn a_run_that_reached_a_terminal_status_loses_its_watcher() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    terminate_run(&fixture, "run-a").await;
    supervisor.reconcile().await.expect("reconcile watchers");

    assert_eq!(supervisor.live_count(), 0);
}

#[tokio::test]
async fn shutdown_stops_every_watcher_and_starts_no_more() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    supervisor.stop_all();
    supervisor
        .reconcile()
        .await
        .expect("reconcile after shutdown");

    assert_eq!(supervisor.live_count(), 0);
    assert_eq!(
        watcher.started_roots().len(),
        1,
        "no watcher starts after shutdown"
    );
}

#[tokio::test]
async fn eligible_watchers_are_reconstructed_after_a_restart_and_rescan_what_they_missed() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    // Written while nothing was watching, exactly as it would be during a
    // restart: no event describes it, and only a rescan can find it.
    write(&root, "WRITTEN-WHILE-DOWN.md", "# offline");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();

    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("reconstruct watchers");

    eventually("the missed document is registered", || async {
        fixture.registered().await == vec!["WRITTEN-WHILE-DOWN.md".to_owned()]
    })
    .await;
    assert_eq!(supervisor.live_count(), 1);
}

#[tokio::test]
async fn an_added_document_is_registered_and_published_for_its_own_project() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    write(&root, "notes/Design.HTML", "<html></html>");
    watcher.publish(FilesystemEvent::Touched(root.join("notes/Design.HTML")));

    eventually("the document is published", || async {
        fixture.facts().await == vec!["document.changed notes/Design.HTML".to_owned()]
    })
    .await;
    assert_eq!(
        fixture.fact_projects().await,
        vec![PROJECT.to_owned()],
        "the project is resolved from the owning Work Item, not from the watcher",
    );
}

#[tokio::test]
async fn a_rewritten_document_publishes_one_change_and_an_untouched_one_publishes_none() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    write(&root, "SPEC.md", "# spec");
    write(&root, "OTHER.md", "# other");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");
    eventually("the initial rescan registers both documents", || async {
        fixture.registered().await.len() == 2
    })
    .await;

    write(&root, "SPEC.md", "# spec, rewritten");
    watcher.publish(FilesystemEvent::Touched(root.join("SPEC.md")));
    // A write to something that is not a document must not become a registry
    // change of any kind.
    write(&root, "logo.png", "not a document");
    watcher.publish(FilesystemEvent::Touched(root.join("logo.png")));

    eventually("the rewrite is published", || async {
        fixture.facts().await.len() == 3
    })
    .await;
    let facts = fixture.facts().await;
    assert_eq!(
        facts,
        vec![
            "document.changed OTHER.md".to_owned(),
            "document.changed SPEC.md".to_owned(),
            "document.changed SPEC.md".to_owned(),
        ],
        "two registrations and exactly one rewrite; the image is not a document",
    );
}

#[tokio::test]
async fn a_removed_document_is_pruned_and_published_as_a_deletion() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    write(&root, "SPEC.md", "# spec");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");
    eventually("the document is registered", || async {
        !fixture.registered().await.is_empty()
    })
    .await;

    std::fs::remove_file(root.join("SPEC.md")).expect("remove the document");
    watcher.publish(FilesystemEvent::Vanished(root.join("SPEC.md")));

    eventually("the removal is published", || async {
        fixture
            .facts()
            .await
            .contains(&"document.deleted SPEC.md".to_owned())
    })
    .await;
    assert!(fixture.registered().await.is_empty());
}

#[tokio::test]
async fn a_burst_of_writes_to_one_document_settles_once() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    // A streamed write: the file grows under a burst of events, and only its
    // final content is the document anyone reads.
    for chunk in 0..20 {
        write(&root, "SPEC.md", &format!("# spec {chunk}"));
        watcher.publish(FilesystemEvent::Touched(root.join("SPEC.md")));
    }

    eventually("the streamed document is registered", || async {
        !fixture.registered().await.is_empty()
    })
    .await;
    tokio::time::sleep(WINDOW * 4).await;
    assert_eq!(
        fixture.facts().await,
        vec!["document.changed SPEC.md".to_owned()],
        "a burst on one path is one settlement, not one per chunk",
    );
}

#[tokio::test]
async fn queue_overflow_falls_back_to_a_full_authorized_rescan() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    // The document nobody reported: its events are exactly what the overflow
    // dropped, so only a rescan can find it.
    write(&root, "notes/MISSED.md", "# missed");
    watcher.publish(FilesystemEvent::Overflowed);

    eventually("the missed document is registered", || async {
        fixture.registered().await == vec!["notes/MISSED.md".to_owned()]
    })
    .await;
}

#[tokio::test]
async fn a_watcher_failure_falls_back_to_a_full_authorized_rescan() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    write(&root, "MISSED.md", "# missed");
    watcher.publish(FilesystemEvent::Failed);

    eventually("the missed document is registered", || async {
        fixture.registered().await == vec!["MISSED.md".to_owned()]
    })
    .await;
}

#[tokio::test]
async fn an_ended_event_stream_re_reads_the_root_before_the_watcher_gives_up() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    std::fs::create_dir_all(&root).expect("create the design directory");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    let supervisor = supervisor(&fixture, &watcher);
    supervisor.reconcile().await.expect("start the watcher");

    write(&root, "LAST.md", "# last");
    watcher.close();

    eventually("the final document is registered", || async {
        fixture.registered().await == vec!["LAST.md".to_owned()]
    })
    .await;
}

#[tokio::test]
async fn a_directory_that_cannot_be_watched_still_reconciles_through_the_registry() {
    let fixture = fixture().await;
    let root = design_dir(&fixture);
    write(&root, "SPEC.md", "# spec");
    register_run(&fixture, "run-a", "task", "running", &root).await;
    let watcher = ScriptedWatcher::default();
    watcher.unwatchable.lock().unwrap().push(
        root.canonicalize()
            .expect("canonicalize the design directory"),
    );
    let supervisor = supervisor(&fixture, &watcher);

    supervisor.reconcile().await.expect("reconcile watchers");

    assert_eq!(
        supervisor.live_count(),
        0,
        "no watcher claims an unwatchable root"
    );
    let rows = fixture
        .documents()
        .refresh_task(TaskRegistryScope {
            task_id: PUBLIC_TASK.to_owned(),
            project_id: Some(PUBLIC_PROJECT.to_owned()),
            module_id: Some(PUBLIC_MODULE.to_owned()),
        })
        .await
        .expect("refresh the registry");
    assert_eq!(
        rows.iter()
            .map(|row| row.rel_path.as_str())
            .collect::<Vec<_>>(),
        vec!["SPEC.md"],
        "live discovery is an optimization; the registry still converges without it",
    );
}

#[tokio::test]
async fn a_refresh_publishes_the_bucket_a_consumer_must_invalidate() {
    let fixture = fixture().await;
    write(&design_dir(&fixture), "SPEC.md", "# spec");

    fixture
        .documents()
        .refresh_task(TaskRegistryScope {
            task_id: PUBLIC_TASK.to_owned(),
            project_id: Some(PUBLIC_PROJECT.to_owned()),
            module_id: Some(PUBLIC_MODULE.to_owned()),
        })
        .await
        .expect("refresh the registry");

    let payloads = fixture.fact_payloads().await;
    assert_eq!(payloads.len(), 1);
    let payload: serde_json::Value =
        serde_json::from_str(&payloads[0]).expect("decode the document fact");
    assert_eq!(payload["scope"], "task");
    assert_eq!(payload["ownerId"], PUBLIC_TASK);
    assert_eq!(payload["moduleId"], PUBLIC_MODULE);
    assert_eq!(payload["relPath"], "SPEC.md");
    assert_eq!(payload["changeKind"], "created");
    assert!(
        payload.get("rootDir").is_none() && payload.get("discoveredByRunId").is_none(),
        "a fact never publishes an absolute root or discovery provenance",
    );
}

#[tokio::test]
async fn an_unchanged_rescan_publishes_nothing_at_all() {
    let fixture = fixture().await;
    write(&design_dir(&fixture), "SPEC.md", "# spec");
    let documents = fixture.documents();
    let scope = TaskRegistryScope {
        task_id: PUBLIC_TASK.to_owned(),
        project_id: Some(PUBLIC_PROJECT.to_owned()),
        module_id: Some(PUBLIC_MODULE.to_owned()),
    };
    documents
        .refresh_task(scope.clone())
        .await
        .expect("first pass");

    for _ in 0..3 {
        documents
            .refresh_task(scope.clone())
            .await
            .expect("repeat pass");
    }

    assert_eq!(
        fixture.facts().await,
        vec!["document.changed SPEC.md".to_owned()],
        "convergence is what makes rescanning a safe universal fallback",
    );
}
