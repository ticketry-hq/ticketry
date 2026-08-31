//! Discovering, listing, and serving authorized documents through the runtime.
//!
//! Every case enters through a public seam — the composed GraphQL schema or
//! the Documents application service the desktop protocol also uses — and
//! asserts on the authoritative registry, the bytes served, and what the
//! filesystem actually holds. Nothing here pins a private helper, a scan
//! order, or a query count.

use muxed_studio_lib::documents::{
    registry_refresh, DocumentsService, TaskRegistryScope, SCRATCH_TASK_ID,
};
use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tauri_graphql::{TransportApi, TransportApiImpl};

const PROJECT: &str = "11111111111111111111111111111111";
const PUBLIC_PROJECT: &str = "11111111-1111-1111-1111-111111111111";
const MODULE: &str = "44444444444444444444444444444444";
const PUBLIC_MODULE: &str = "44444444-4444-4444-4444-444444444444";
const TASK: &str = "33333333333333333333333333333333";
const PUBLIC_TASK: &str = "33333333-3333-3333-3333-333333333333";
const FOREIGN_PROJECT: &str = "22222222222222222222222222222222";
const PUBLIC_FOREIGN_PROJECT: &str = "22222222-2222-2222-2222-222222222222";
const FOREIGN_MODULE: &str = "66666666666666666666666666666666";
const PUBLIC_FOREIGN_MODULE: &str = "66666666-6666-6666-6666-666666666666";

struct Fixture {
    directory: tempfile::TempDir,
    database: DatabaseConnection,
}

impl Fixture {
    fn path(&self) -> &std::path::Path {
        self.directory.path()
    }

    fn service(&self) -> DocumentsService {
        DocumentsService::new(self.database.clone())
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
}

/// A state.db carrying the adopted Documents shape plus enough WorkTracker
/// scope for two projects.
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create a Documents fixture directory");
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
        CREATE TABLE worktracker_project (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            slug TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            seq_counter INTEGER NOT NULL DEFAULT 0, state_revision INTEGER NOT NULL DEFAULT 0,
            manual_module_order BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00',
            updated_at DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00',
            onboarding_required bool NOT NULL
        );
        CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, ticket_seq INTEGER, agent TEXT NOT NULL,
            status TEXT NOT NULL, started_at TEXT NOT NULL,
            ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
            lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
            scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT, initial_prompt TEXT,
            launch_reasoning TEXT, launch_unattended BOOL NOT NULL DEFAULT 0
        );
        INSERT INTO worktracker_issue (id, project_id, type, module_id, name, sequence_id) VALUES
            ('{MODULE}','{PROJECT}','module',NULL,'Platform Runtime',12),
            ('{TASK}','{PROJECT}','task','{MODULE}','Discover and render authorized documents',758),
            ('{FOREIGN_MODULE}','{FOREIGN_PROJECT}','module',NULL,'Other Module',13);
    "#
        ))
        .await
        .expect("create the Documents fixture schema");
    let fixture = Fixture {
        directory,
        database,
    };
    fixture.link_module().await;
    fixture
}

/// Compose the shipping schema over this fixture: registry refresh writes
/// rows, so it needs the same writable composition production installs.
async fn install(fixture: &Fixture) -> TransportApiImpl {
    let api = TransportApiImpl::new();
    initialize_with_worktracker_commands_and_install(
        &fixture.path().join("rust-core.sqlite3"),
        &fixture.path().join("state.db"),
        &fixture.path().join("media"),
        &api,
    )
    .await
    .expect("install the composed GraphQL endpoint");
    api
}

async fn execute(
    api: &TransportApiImpl,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    let response = api
        .clone()
        .graphql_execute(serde_json::json!({ "query": query, "variables": variables }).to_string())
        .await;
    serde_json::from_str(&response).expect("decode the GraphQL response")
}

fn write(root: &std::path::Path, relative: &str, body: &str) {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().expect("a parent directory"))
        .expect("create the parent directory");
    std::fs::write(path, body).expect("write the document");
}

/// The canonical task design directory, spelled the way an agent that renamed
/// nothing would have created it.
fn canonical_task_dir(fixture: &Fixture) -> std::path::PathBuf {
    fixture
        .path()
        .join("checkout")
        .join("spec")
        .join("platform-runtime--44444444")
        .join("T758--discover-and-render-authorized-documents")
}

async fn register_run(fixture: &Fixture, id: &str, issue: &str, scope: &str, design_dir: &str) {
    fixture
        .database
        .execute_unprepared(&format!(
            r#"INSERT INTO agent_runs (id, issue_id, agent, status, started_at, scope, design_dir)
               VALUES ('{id}', '{issue}', 'codex', 'running', '2026-01-01T00:00:00Z',
                       '{scope}', '{design_dir}')"#
        ))
        .await
        .expect("register the Agent Run");
}

const REFRESH_TASK: &str = r#"
mutation($task: String!, $project: String, $module: String) {
  refresh_task_document_registry(task_id: $task, project_id: $project, module_id: $module) {
    id
    relPath
  }
}"#;

const REFRESH_SCRATCH: &str = r#"
mutation($module: String!) {
  refresh_scratch_document_registry(module_id: $module) { id relPath }
}"#;

fn paths(response: &serde_json::Value, field: &str) -> Vec<String> {
    response
        .pointer(&format!("/data/{field}"))
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| panic!("no {field} rows in {response}"))
        .iter()
        .map(|row| row["relPath"].as_str().expect("a relative path").to_owned())
        .collect()
}

#[tokio::test]
async fn a_task_rescan_discovers_nested_documents_case_insensitively() {
    let fixture = fixture().await;
    let root = canonical_task_dir(&fixture);
    write(&root, "SPEC.MD", "# spec");
    write(
        &root,
        "notes/Design.HTML",
        "<html><img src=\"logo.png\"></html>",
    );
    write(&root, "notes/logo.png", "not a document");
    let api = install(&fixture).await;

    let response = execute(
        &api,
        REFRESH_TASK,
        serde_json::json!({
            "task": PUBLIC_TASK,
            "project": PUBLIC_PROJECT,
            "module": PUBLIC_MODULE,
        }),
    )
    .await;

    assert_eq!(
        paths(&response, "refresh_task_document_registry"),
        vec!["SPEC.MD".to_owned(), "notes/Design.HTML".to_owned()],
        "only Markdown and HTML are documents, at any depth and in any case",
    );
}

#[tokio::test]
async fn a_renamed_module_and_work_item_keep_resolving_the_existing_directory() {
    let fixture = fixture().await;
    // The directory an earlier, differently named module and task created.
    let renamed = fixture
        .path()
        .join("checkout/spec/an-older-module-name--44444444/T758--an-older-title");
    write(&renamed, "SPEC.md", "# spec");
    let api = install(&fixture).await;

    let response = execute(
        &api,
        REFRESH_TASK,
        serde_json::json!({
            "task": PUBLIC_TASK,
            "project": PUBLIC_PROJECT,
            "module": PUBLIC_MODULE,
        }),
    )
    .await;

    assert_eq!(
        paths(&response, "refresh_task_document_registry"),
        vec!["SPEC.md".to_owned()],
    );
    assert!(
        !canonical_task_dir(&fixture).exists(),
        "resolution reuses the existing directory rather than minting a new one",
    );
}

#[tokio::test]
async fn a_scratch_rescan_finds_run_scoped_planning_documents() {
    let fixture = fixture().await;
    let planning = fixture
        .path()
        .join("checkout/spec/platform-runtime--44444444/planning/3f2a91c4");
    write(&planning, "Plan.md", "# plan");
    register_run(
        &fixture,
        "run-plan",
        MODULE,
        "plan",
        &planning.to_string_lossy(),
    )
    .await;
    let api = install(&fixture).await;

    let response = execute(
        &api,
        REFRESH_SCRATCH,
        serde_json::json!({ "module": PUBLIC_MODULE }),
    )
    .await;

    assert_eq!(
        paths(&response, "refresh_scratch_document_registry"),
        vec!["Plan.md".to_owned()],
    );
}

#[tokio::test]
async fn scratch_and_task_buckets_do_not_leak_into_each_other() {
    let fixture = fixture().await;
    let task_root = canonical_task_dir(&fixture);
    write(&task_root, "SPEC.md", "# spec");
    let planning = fixture
        .path()
        .join("checkout/spec/platform-runtime--44444444/planning/3f2a91c4");
    write(&planning, "Plan.md", "# plan");
    register_run(
        &fixture,
        "run-plan",
        MODULE,
        "plan",
        &planning.to_string_lossy(),
    )
    .await;
    let api = install(&fixture).await;

    let task = execute(
        &api,
        REFRESH_TASK,
        serde_json::json!({
            "task": PUBLIC_TASK,
            "project": PUBLIC_PROJECT,
            "module": PUBLIC_MODULE,
        }),
    )
    .await;
    let scratch = execute(
        &api,
        REFRESH_SCRATCH,
        serde_json::json!({ "module": PUBLIC_MODULE }),
    )
    .await;

    assert_eq!(
        paths(&task, "refresh_task_document_registry"),
        vec!["SPEC.md".to_owned()]
    );
    assert_eq!(
        paths(&scratch, "refresh_scratch_document_registry"),
        vec!["Plan.md".to_owned()]
    );
}

#[tokio::test]
async fn a_module_in_another_project_resolves_no_authorized_root() {
    let fixture = fixture().await;
    write(&canonical_task_dir(&fixture), "SPEC.md", "# spec");
    let api = install(&fixture).await;

    let response = execute(
        &api,
        REFRESH_TASK,
        serde_json::json!({
            "task": PUBLIC_TASK,
            "project": PUBLIC_FOREIGN_PROJECT,
            "module": PUBLIC_FOREIGN_MODULE,
        }),
    )
    .await;

    assert!(
        paths(&response, "refresh_task_document_registry").is_empty(),
        "a cross-project scope must not reach another project's module folder",
    );
}

#[tokio::test]
async fn a_rescan_over_an_unchanged_directory_changes_no_row() {
    let fixture = fixture().await;
    write(&canonical_task_dir(&fixture), "SPEC.md", "# spec");
    let service = fixture.service();
    let scope = TaskRegistryScope {
        task_id: PUBLIC_TASK.to_owned(),
        project_id: Some(PUBLIC_PROJECT.to_owned()),
        module_id: Some(PUBLIC_MODULE.to_owned()),
    };

    let first = service
        .refresh_task(scope.clone())
        .await
        .expect("first pass");
    let second = service.refresh_task(scope).await.expect("second pass");

    assert_eq!(first.len(), 1);
    assert_eq!(
        first, second,
        "an unchanged directory rescans to byte-identical rows",
    );
}

#[tokio::test]
async fn a_removed_file_prunes_its_row_and_a_new_file_is_registered() {
    let fixture = fixture().await;
    let root = canonical_task_dir(&fixture);
    write(&root, "SPEC.md", "# spec");
    let service = fixture.service();
    let scope = TaskRegistryScope {
        task_id: PUBLIC_TASK.to_owned(),
        project_id: Some(PUBLIC_PROJECT.to_owned()),
        module_id: Some(PUBLIC_MODULE.to_owned()),
    };
    service
        .refresh_task(scope.clone())
        .await
        .expect("first pass");

    std::fs::remove_file(root.join("SPEC.md")).expect("remove the document");
    write(&root, "notes/LATER.md", "# later");
    let rows = service.refresh_task(scope).await.expect("second pass");

    assert_eq!(
        rows.iter()
            .map(|row| row.rel_path.as_str())
            .collect::<Vec<_>>(),
        vec!["notes/LATER.md"],
    );
}

#[tokio::test]
async fn a_document_registered_by_a_run_root_outside_the_module_folder_is_still_served() {
    let fixture = fixture().await;
    let worktree_root = fixture.path().join("worktrees/T758/spec/design");
    write(&worktree_root, "SPEC.md", "# from a worktree");
    register_run(
        &fixture,
        "run-task",
        TASK,
        "task",
        &worktree_root.to_string_lossy(),
    )
    .await;
    let service = fixture.service();

    let rows = service
        .refresh_task(TaskRegistryScope {
            task_id: PUBLIC_TASK.to_owned(),
            project_id: None,
            module_id: None,
        })
        .await
        .expect("refresh through the run's authorized root");
    let asset = service
        .read_asset(&rows[0].id, "SPEC.md")
        .await
        .expect("read the document")
        .expect("the document is servable");

    assert_eq!(asset.bytes, b"# from a worktree");
    assert_eq!(asset.media_type, "text/markdown");
    assert!(asset.etag.is_some(), "Markdown carries its guard digest");
}

#[tokio::test]
async fn traversal_symlink_escapes_and_unknown_documents_are_all_the_same_absence() {
    let fixture = fixture().await;
    let root = canonical_task_dir(&fixture);
    write(&root, "SPEC.md", "# spec");
    write(&root, "assets/site.css", "body{}");
    write(&root, "assets/notes.bin", "raw bytes");
    let outside = fixture.path().join("outside");
    write(&outside, "secret.md", "secret");
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.join("secret.md"), root.join("escape.md"))
        .expect("create the escaping symlink");
    let service = fixture.service();
    let rows = service
        .refresh_task(TaskRegistryScope {
            task_id: PUBLIC_TASK.to_owned(),
            project_id: Some(PUBLIC_PROJECT.to_owned()),
            module_id: Some(PUBLIC_MODULE.to_owned()),
        })
        .await
        .expect("refresh the registry");
    let document = rows
        .iter()
        .find(|row| row.rel_path == "SPEC.md")
        .expect("the primary document is registered");

    assert!(
        service
            .read_asset(&document.id, "assets/site.css")
            .await
            .expect("resolve an allowed asset")
            .is_some(),
        "a relative asset inside the authorized root is servable",
    );
    for refused in [
        "../../../../etc/hosts",
        "assets/../../outside/secret.md",
        "escape.md",
        "assets/notes.bin",
        "assets",
        "absent.md",
    ] {
        assert!(
            service
                .read_asset(&document.id, refused)
                .await
                .expect("a refusal is data rather than an error")
                .is_none(),
            "{refused} must not be servable",
        );
    }
    assert!(service
        .read_asset("no-such-document", "SPEC.md")
        .await
        .expect("an unknown document is data rather than an error")
        .is_none(),);
    assert!(
        !rows.iter().any(|row| row.rel_path == "escape.md"),
        "a symlink escaping the boundary is never registered as a document",
    );
}

#[tokio::test]
async fn directory_completion_preserves_prefix_sorting_and_hidden_behaviour() {
    let fixture = fixture().await;
    for name in ["alpha", "alpine", "beta", ".hidden"] {
        std::fs::create_dir_all(fixture.path().join("checkout").join(name))
            .expect("create a child directory");
    }
    let api = install(&fixture).await;
    let base = fixture.path().join("checkout");

    let visible = execute(
        &api,
        "query($path: String!) { directory_completions(path: $path) }",
        serde_json::json!({ "path": format!("{}/", base.display()) }),
    )
    .await;
    let filtered = execute(
        &api,
        "query($path: String!) { directory_completions(path: $path) }",
        serde_json::json!({ "path": format!("{}/alp", base.display()) }),
    )
    .await;

    let names = |value: &serde_json::Value| -> Vec<String> {
        value["data"]["directory_completions"]
            .as_array()
            .expect("a completion list")
            .iter()
            .map(|path| {
                std::path::Path::new(path.as_str().expect("a path"))
                    .file_name()
                    .expect("a directory name")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    };

    assert_eq!(names(&visible), vec!["alpha", "alpine", "beta"]);
    assert_eq!(names(&filtered), vec!["alpha", "alpine"]);
}

#[tokio::test]
async fn the_scratch_bucket_is_addressed_by_the_established_sentinel() {
    let fixture = fixture().await;
    let planning = fixture
        .path()
        .join("checkout/spec/platform-runtime--44444444/planning/3f2a91c4");
    write(&planning, "Plan.md", "# plan");
    register_run(
        &fixture,
        "run-plan",
        MODULE,
        "instant",
        &planning.to_string_lossy(),
    )
    .await;

    let rows = registry_refresh::refresh_scratch(&fixture.database, None, PUBLIC_MODULE)
        .await
        .expect("refresh the scratch registry");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].task_id, SCRATCH_TASK_ID);
}
