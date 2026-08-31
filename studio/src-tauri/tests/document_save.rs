//! Saving one registered Markdown document, and surviving every crash window.
//!
//! Every case enters through a public seam — the composed GraphQL schema, the
//! Workspace Operation journal, or the save service's own reconciler — and
//! asserts on what an operator can observe afterwards: the bytes on disk, the
//! recorded digest, the durable operation, the published facts, and what is
//! left in the design directory. Nothing here pins a private helper.
//!
//! The fault-injection cases build the exact durable and filesystem state each
//! crash window leaves behind, then reconcile twice — two restarts — and
//! assert convergence on one file version, one operation result, one registry
//! digest, and no duplicate fact.

use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_documents::DocumentFactRecorder;
use ticketry_graphql_schema::graphql_foundation::initialize_with_worktracker_commands_and_install;
use ticketry_runs::persistence::RunsServices;
use ticketry_workspace_runtime::workspace::document_save::{
    staging_file_name, DocumentSaveService, STAGING_PREFIX,
};
use ticketry_workspace_runtime::workspace::operations::{
    schema as journal_schema, WorkspaceOperationIntent, WorkspaceOperationJournal,
    WorkspaceOperationKind,
};

const PROJECT: &str = "11111111111111111111111111111111";
const MODULE: &str = "44444444444444444444444444444444";
const PUBLIC_MODULE: &str = "44444444-4444-4444-4444-444444444444";
const TASK: &str = "33333333333333333333333333333333";
const PUBLIC_TASK: &str = "33333333-3333-3333-3333-333333333333";
const DOCUMENT: &str = "77777777777777777777777777777777";

const SAVE: &str = r#"
mutation($document: String!, $expected: String!, $content: String!, $operation: String!) {
  save_design_document(
    document_id: $document
    expected_digest: $expected
    content: $content
    operation_id: $operation
  ) {
    document_id
    digest
    saved
    stale
  }
}"#;

struct Fixture {
    directory: tempfile::TempDir,
    database: DatabaseConnection,
}

impl Fixture {
    fn path(&self) -> &std::path::Path {
        self.directory.path()
    }

    /// The authorized design directory the registered document lives in.
    fn design_dir(&self) -> std::path::PathBuf {
        self.path().join("checkout").join("design")
    }

    fn document(&self) -> std::path::PathBuf {
        self.design_dir().join("SPEC.md")
    }

    fn body(&self) -> Vec<u8> {
        std::fs::read(self.document()).expect("read the primary document")
    }

    fn journal(&self) -> WorkspaceOperationJournal {
        WorkspaceOperationJournal::new(self.database.clone())
    }

    /// The save capability, composed exactly as startup composes it.
    fn saves(&self) -> DocumentSaveService {
        DocumentSaveService::new(
            self.database.clone(),
            self.journal(),
            Some(DocumentFactRecorder::new(
                RunsServices::new(self.database.clone())
                    .outbox()
                    .events()
                    .clone(),
            )),
        )
    }
}

/// A state.db carrying the adopted Documents shape, the durable outbox, and one
/// registered Markdown document whose file exists on disk.
async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().expect("create a save fixture directory");
    let database = Database::connect(format!(
        "sqlite:{}?mode=rwc",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open the fixture database");
    let design_dir = directory.path().join("checkout").join("design");
    std::fs::create_dir_all(&design_dir).expect("create the design directory");
    std::fs::write(design_dir.join("SPEC.md"), "# original").expect("write the document");
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
            description TEXT NOT NULL DEFAULT '', workspace_tab_order TEXT NOT NULL DEFAULT '[]',
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
            model TEXT, reasoning TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,
            ended_at TEXT, exit_code INTEGER, error TEXT, cwd TEXT, provider_session_id TEXT,
            lifecycle_state TEXT, lifecycle_updated_at TEXT, design_dir TEXT, resumed_from TEXT,
            scope TEXT NOT NULL, launch_state TEXT, launch_model TEXT
        );
        CREATE TABLE runs_status_events (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            project_id TEXT NOT NULL, event_kind TEXT NOT NULL, payload_version INTEGER NOT NULL,
            subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, agent_run_id TEXT,
            automation_attempt_id TEXT, work_item_id TEXT, payload TEXT NOT NULL,
            committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO worktracker_issue (id, project_id, type, module_id, name, sequence_id) VALUES
            ('{MODULE}','{PROJECT}','module',NULL,'Platform Runtime',12),
            ('{TASK}','{PROJECT}','task','{MODULE}','Save Markdown',760);
        INSERT INTO design_documents
            (id, module_id, task_id, scope, root_dir, rel_path, created_at, updated_at)
        VALUES ('{DOCUMENT}','{PUBLIC_MODULE}','{PUBLIC_TASK}','task','{root}','SPEC.md',
                '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    "#,
            root = canonical(&design_dir).display()
        ))
        .await
        .expect("create the save fixture schema");
    journal_schema::install(&database)
        .await
        .expect("install the Workspace Operation journal");
    Fixture {
        directory,
        database,
    }
}

/// Compose the shipping schema over this fixture.
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

async fn execute(api: &TransportApiImpl, query: &str, variables: Value) -> Value {
    let response = api
        .clone()
        .graphql_execute(json!({ "query": query, "variables": variables }).to_string())
        .await;
    serde_json::from_str(&response).expect("decode the GraphQL response")
}

async fn save(api: &TransportApiImpl, expected: &str, content: &str, operation: &str) -> Value {
    execute(
        api,
        SAVE,
        json!({
            "document": DOCUMENT,
            "expected": expected,
            "content": content,
            "operation": operation,
        }),
    )
    .await
}

fn digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn canonical(path: &std::path::Path) -> std::path::PathBuf {
    path.canonicalize()
        .expect("canonicalize the design directory")
}

fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).hyphenated().to_string()
}

fn db_id(value: u128) -> String {
    uuid::Uuid::from_u128(value).simple().to_string()
}

fn outcome<'a>(response: &'a Value) -> &'a Value {
    response
        .pointer("/data/save_design_document")
        .unwrap_or_else(|| panic!("no save outcome in {response}"))
}

fn error_code(response: &Value) -> String {
    response
        .pointer("/errors/0/extensions/code")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("no error code in {response}"))
        .to_owned()
}

/// The intent one save prepares, in the shape the journal stores it. Recovery
/// reads exactly this back, so the fault-injection cases build it directly.
fn save_intent(
    fixture: &Fixture,
    operation: &str,
    expected: &[u8],
    intended: &[u8],
) -> WorkspaceOperationIntent {
    WorkspaceOperationIntent {
        operation_id: operation.to_owned(),
        kind: WorkspaceOperationKind::DocumentSave,
        intent_version: 1,
        resource_key: format!("document/{DOCUMENT}"),
        payload: json!({
            "documentId": DOCUMENT,
            "relPath": "SPEC.md",
            "rootDigest": digest(
                canonical(&fixture.design_dir()).to_string_lossy().as_bytes(),
            ),
            "expectedDigest": digest(expected),
            "intendedDigest": digest(intended),
            "byteLength": intended.len() as i64,
        }),
    }
}

async fn registry_digest(fixture: &Fixture) -> Option<String> {
    let row = fixture
        .database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!("SELECT content_digest FROM design_documents WHERE id = '{DOCUMENT}'"),
        ))
        .await
        .expect("read the registry row")
        .expect("the registry row exists");
    row.try_get::<Option<String>>("", "content_digest")
        .expect("read the recorded digest")
}

async fn document_facts(fixture: &Fixture) -> Vec<String> {
    fixture
        .database
        .query_all_raw(sea_orm::Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!(
                "SELECT payload FROM runs_status_events \
                 WHERE subject_id = '{DOCUMENT}' ORDER BY cursor"
            ),
        ))
        .await
        .expect("read the published facts")
        .into_iter()
        .map(|row| row.try_get::<String>("", "payload").expect("a payload"))
        .collect()
}

async fn operation_state(fixture: &Fixture, operation: &str) -> String {
    fixture
        .journal()
        .find(operation)
        .await
        .expect("read the operation")
        .expect("the operation exists")
        .state
}

fn staging_leftovers(fixture: &Fixture) -> Vec<String> {
    std::fs::read_dir(fixture.design_dir())
        .expect("list the design directory")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(STAGING_PREFIX))
        .collect()
}

#[tokio::test]
async fn a_registered_save_replaces_the_file_and_records_one_digest_and_one_fact() {
    let fixture = fixture().await;
    let api = install(&fixture).await;

    let response = save(&api, &digest(b"# original"), "# saved", &id(1)).await;

    assert_eq!(outcome(&response)["saved"], json!(true));
    assert_eq!(outcome(&response)["stale"], json!(false));
    assert_eq!(outcome(&response)["digest"], json!(digest(b"# saved")));
    assert_eq!(fixture.body(), b"# saved");
    assert_eq!(registry_digest(&fixture).await, Some(digest(b"# saved")));
    assert_eq!(document_facts(&fixture).await.len(), 1);
    assert!(staging_leftovers(&fixture).is_empty());
    assert_eq!(operation_state(&fixture, &id(1)).await, "applied");
}

#[tokio::test]
async fn a_stale_save_preserves_the_file_and_a_retry_against_the_current_digest_applies_it() {
    let fixture = fixture().await;
    let api = install(&fixture).await;
    // Somebody else wrote the file after this editor loaded it.
    std::fs::write(fixture.document(), "# theirs").expect("write the external version");

    let stale = save(&api, &digest(b"# original"), "# mine", &id(1)).await;

    assert_eq!(outcome(&stale)["stale"], json!(true));
    assert_eq!(outcome(&stale)["saved"], json!(false));
    assert_eq!(outcome(&stale)["digest"], json!(digest(b"# theirs")));
    assert_eq!(fixture.body(), b"# theirs", "a stale save writes nothing");
    assert_eq!(document_facts(&fixture).await.len(), 0);

    // The editor still holds the draft and deliberately applies it against the
    // version it was just told about, under a fresh operation identity.
    let applied = save(&api, &digest(b"# theirs"), "# mine", &id(2)).await;

    assert_eq!(outcome(&applied)["saved"], json!(true));
    assert_eq!(fixture.body(), b"# mine");
    assert_eq!(registry_digest(&fixture).await, Some(digest(b"# mine")));
    assert_eq!(document_facts(&fixture).await.len(), 1);
}

#[tokio::test]
async fn one_operation_identity_replays_its_durable_outcome_and_never_writes_twice() {
    let fixture = fixture().await;
    let api = install(&fixture).await;

    let first = save(&api, &digest(b"# original"), "# saved", &id(1)).await;
    // The response was lost, so the same request arrives again.
    let replayed = save(&api, &digest(b"# original"), "# saved", &id(1)).await;

    assert_eq!(outcome(&first), outcome(&replayed));
    assert_eq!(fixture.body(), b"# saved");
    assert_eq!(document_facts(&fixture).await.len(), 1, "one fact only");
}

#[tokio::test]
async fn a_different_document_version_under_one_identity_is_refused() {
    let fixture = fixture().await;
    let api = install(&fixture).await;

    save(&api, &digest(b"# original"), "# saved", &id(1)).await;
    let rebound = save(&api, &digest(b"# original"), "# something else", &id(1)).await;

    assert_eq!(error_code(&rebound), "document_save_replay_mismatch");
    assert_eq!(fixture.body(), b"# saved", "the durable version stands");
}

#[tokio::test]
async fn an_unknown_document_and_an_unusable_digest_are_refused_before_anything_is_written() {
    let fixture = fixture().await;
    let api = install(&fixture).await;

    let unknown = execute(
        &api,
        SAVE,
        json!({
            "document": "99999999999999999999999999999999",
            "expected": digest(b"# original"),
            "content": "# saved",
            "operation": id(1),
        }),
    )
    .await;
    let unusable = save(&api, "not-a-digest", "# saved", &id(2)).await;

    assert_eq!(error_code(&unknown), "document_save_not_found");
    assert_eq!(error_code(&unusable), "document_save_request_invalid");
    assert_eq!(fixture.body(), b"# original");
    assert!(staging_leftovers(&fixture).is_empty());
}

#[tokio::test]
async fn a_crash_after_staging_finishes_the_rename_and_converges_after_two_restarts() {
    let fixture = fixture().await;
    let operation = id(1);
    // Prepared, staged, flushed — and then the process died before the rename.
    fixture
        .journal()
        .prepare(save_intent(
            &fixture,
            &operation,
            b"# original",
            b"# staged",
        ))
        .await
        .expect("prepare the save");
    std::fs::write(
        fixture.design_dir().join(staging_file_name(&db_id(1))),
        "# staged",
    )
    .expect("stage the intended bytes");

    let saves = fixture.saves();
    saves.reconciler().reconcile().await.expect("first restart");
    saves
        .reconciler()
        .reconcile()
        .await
        .expect("second restart");

    assert_eq!(fixture.body(), b"# staged");
    assert_eq!(registry_digest(&fixture).await, Some(digest(b"# staged")));
    assert_eq!(document_facts(&fixture).await.len(), 1);
    assert_eq!(operation_state(&fixture, &operation).await, "applied");
    assert!(staging_leftovers(&fixture).is_empty());
}

#[tokio::test]
async fn a_crash_after_the_rename_adopts_the_file_and_records_it_once() {
    let fixture = fixture().await;
    let operation = id(1);
    fixture
        .journal()
        .prepare(save_intent(
            &fixture,
            &operation,
            b"# original",
            b"# renamed",
        ))
        .await
        .expect("prepare the save");
    // The rename committed; the settlement transaction never did.
    std::fs::write(fixture.document(), "# renamed").expect("apply the rename");

    let saves = fixture.saves();
    saves.reconciler().reconcile().await.expect("first restart");
    saves
        .reconciler()
        .reconcile()
        .await
        .expect("second restart");

    assert_eq!(fixture.body(), b"# renamed", "one file version");
    assert_eq!(registry_digest(&fixture).await, Some(digest(b"# renamed")));
    assert_eq!(document_facts(&fixture).await.len(), 1, "no duplicate fact");
    assert_eq!(operation_state(&fixture, &operation).await, "applied");
}

#[tokio::test]
async fn a_crash_before_staging_leaves_the_file_untouched_rather_than_guessing_at_it() {
    let fixture = fixture().await;
    let operation = id(1);
    // Prepared, and then nothing: the intended bytes never reached the disk,
    // and the journal deliberately never held them.
    fixture
        .journal()
        .prepare(save_intent(&fixture, &operation, b"# original", b"# lost"))
        .await
        .expect("prepare the save");

    let saves = fixture.saves();
    saves.reconciler().reconcile().await.expect("first restart");
    saves
        .reconciler()
        .reconcile()
        .await
        .expect("second restart");

    assert_eq!(fixture.body(), b"# original");
    assert_eq!(registry_digest(&fixture).await, None);
    assert_eq!(document_facts(&fixture).await.len(), 0);
    assert_eq!(operation_state(&fixture, &operation).await, "failed");
}

#[tokio::test]
async fn a_document_that_moved_on_under_a_prepared_save_is_a_non_overwriting_conflict() {
    let fixture = fixture().await;
    let operation = id(1);
    fixture
        .journal()
        .prepare(save_intent(&fixture, &operation, b"# original", b"# mine"))
        .await
        .expect("prepare the save");
    std::fs::write(
        fixture.design_dir().join(staging_file_name(&db_id(1))),
        "# mine",
    )
    .expect("stage the intended bytes");
    // Somebody else replaced the file while this save was in flight.
    std::fs::write(fixture.document(), "# theirs").expect("write the external version");

    let saves = fixture.saves();
    saves.reconciler().reconcile().await.expect("first restart");
    saves
        .reconciler()
        .reconcile()
        .await
        .expect("second restart");

    assert_eq!(fixture.body(), b"# theirs", "evidence is never overwritten");
    assert_eq!(registry_digest(&fixture).await, None);
    assert_eq!(document_facts(&fixture).await.len(), 0);
    assert_eq!(operation_state(&fixture, &operation).await, "conflicted");
}

#[tokio::test]
async fn cleanup_removes_only_the_staging_files_no_operation_still_owns() {
    let fixture = fixture().await;
    let api = install(&fixture).await;
    // An abandoned staging file from a previous process, a staging file whose
    // operation is still open, and two files that are simply not ours.
    let abandoned = staging_file_name(&db_id(90));
    let owned = staging_file_name(&db_id(91));
    fixture
        .journal()
        .prepare(save_intent(&fixture, &id(91), b"# original", b"# other"))
        .await
        .expect("prepare the other save");
    for (name, body) in [
        (abandoned.as_str(), "# abandoned"),
        (owned.as_str(), "# other"),
        (".ticketry-save-not-a-uuid.part", "# foreign"),
        (".notes.md.swp", "# somebody else's"),
    ] {
        std::fs::write(fixture.design_dir().join(name), body).expect("write the leftover");
    }

    save(&api, &digest(b"# original"), "# saved", &id(1)).await;

    let mut left = staging_leftovers(&fixture);
    left.sort();
    let mut kept = vec![".ticketry-save-not-a-uuid.part".to_owned(), owned];
    kept.sort();
    assert_eq!(
        left, kept,
        "only unowned Ticketry staging files are removed"
    );
    assert!(fixture.design_dir().join(".notes.md.swp").exists());
}
