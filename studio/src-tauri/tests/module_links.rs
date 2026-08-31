//! The typed Module Link entity and its one-way import from profile files.
//!
//! The import is the least reversible part of this slice: it reads a user's
//! only record of which folder a Module lives in and turns it into rows that a
//! later slice will make authoritative. So these tests pin the policy, not
//! just the happy path — which links are refused and why, what a repeat run is
//! allowed to touch, what a rollback removes, and the fact that no importer can
//! reach an installation its caller did not name.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use ticketry_work_management::module_links::{
    self, legacy_source, receipt::ImportReceipt, ImportOutcome, LinkStatus, LocalModulePath,
    ModuleLinkErrorCode, ModuleLinkStore, SkipReason,
};
use ticketry_work_management::module_links::{identity, ownership_manifest, schema};
use ticketry_work_management::work_management::open_for_commands;

const PROJECT: &str = "10000000000000000000000000000000";
const MODULE_TYPE: &str = "30000000000000000000000000000003";
const TASK_TYPE: &str = "30000000000000000000000000000001";
const STUDIO: &str = "20000000000000000000000000000001";
const SERVICE: &str = "20000000000000000000000000000002";
const TASK: &str = "20000000000000000000000000000009";
const ABSENT_MODULE: &str = "2000000000000000000000000000ffff";

fn crate_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

/// A Django-shaped installation with two modules and one ordinary task.
async fn installation() -> (tempfile::TempDir, DatabaseConnection) {
    let directory = tempfile::tempdir().expect("create a module-link fixture directory");
    let path = directory.path().join("state.db");
    let writer = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .expect("open the fixture writer");
    writer
        .execute_unprepared(&format!(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE worktracker_project (
                id char(32) PRIMARY KEY, workspace_id char(32) NOT NULL,
                name varchar(255) NOT NULL, slug varchar(64) NOT NULL,
                description text NOT NULL, seq_counter integer NOT NULL,
                state_revision bigint NOT NULL, manual_module_order bool NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
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
                workspace_tab_order text NOT NULL,
                created_at datetime NOT NULL, updated_at datetime NOT NULL
            );
            INSERT INTO worktracker_project VALUES
                ('{PROJECT}', '90000000000000000000000000000000', 'Ticketry', 'TIC',
                 '', 9, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('{MODULE_TYPE}', '{PROJECT}', 'Module', 'module', '', 0, NULL, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK_TYPE}', '{PROJECT}', 'Task', 'task', '', 1, NULL, 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('{STUDIO}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL,
                 1, 'Studio', 1, 0, 'a', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{SERVICE}', '{PROJECT}', 'module', '{MODULE_TYPE}', NULL, NULL, NULL,
                 1, 'Service', 2, 0, 'b', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('{TASK}', '{PROJECT}', 'task', '{TASK_TYPE}', NULL, '{STUDIO}', NULL,
                 1, 'A task', 3, 0, 'c', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .expect("create the Django-shaped fixture");
    drop(writer);
    let database = open_for_commands(&path)
        .await
        .expect("open the fixture for commands");
    schema::install(&database)
        .await
        .expect("install the typed Module Link schema");
    (directory, database)
}

fn write_profiles(data_directory: &Path, name: &str, body: &str) {
    std::fs::write(data_directory.join(name), body).expect("write the profile fixture");
}

/// One profile naming both modules, with folders that exist on this machine.
fn two_linked_modules(studio: &Path, service: &Path) -> String {
    format!(
        r#"{{"recent_profile_index": 0, "profiles": [
            {{"name": "Local", "workspace_slug": "tic", "module_links": [
                {{"module_id": "{STUDIO}", "path": "{}"}},
                {{"module_id": "{SERVICE}", "path": "{}"}}
            ]}}
        ]}}"#,
        studio.display(),
        service.display()
    )
}

async fn stored_paths(database: &DatabaseConnection) -> Vec<(String, String)> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT module_id, path FROM module_links ORDER BY module_id".to_owned(),
        ))
        .await
        .expect("read the stored links");
    rows.iter()
        .map(|row| {
            (
                row.try_get::<String>("", "module_id").expect("module id"),
                row.try_get::<String>("", "path").expect("path"),
            )
        })
        .collect()
}

#[tokio::test]
async fn an_import_creates_one_row_per_supported_legacy_link() {
    let (directory, database) = installation().await;
    let studio = directory.path().join("studio");
    let service = directory.path().join("service");
    std::fs::create_dir_all(&studio).expect("create the studio folder");
    std::fs::create_dir_all(&service).expect("create the service folder");
    write_profiles(
        directory.path(),
        "profiles.json",
        &two_linked_modules(&studio, &service),
    );

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import the legacy links");

    assert_eq!(outcome.inserted, 2);
    assert!(outcome.receipt_changed);
    assert_eq!(
        stored_paths(&database).await,
        vec![
            (STUDIO.to_owned(), studio.display().to_string()),
            (SERVICE.to_owned(), service.display().to_string()),
        ]
    );
    assert!(outcome
        .receipt
        .links
        .iter()
        .all(|link| link.status == LinkStatus::Imported));
    assert_eq!(
        outcome
            .receipt
            .source
            .as_ref()
            .map(|source| source.name.as_str()),
        Some("profiles.json")
    );
    // The legacy source is still exactly where it was.
    assert!(directory.path().join("profiles.json").is_file());
}

#[tokio::test]
async fn one_module_can_hold_only_one_link() {
    let (directory, database) = installation().await;
    let store = ModuleLinkStore::new(database.clone());
    let first = store
        .set(STUDIO, "/repos/ticketry")
        .await
        .expect("record the first folder");

    // Re-linking moves the module's row rather than minting a second one, so
    // the identity a caller already observed keeps resolving.
    let second = store
        .set(STUDIO, "/repos/ticketry-two")
        .await
        .expect("record the second folder");
    assert_eq!(first.id, second.id);
    assert_eq!(stored_paths(&database).await.len(), 1);

    // The unique index, not the write seam, is what makes that true.
    let direct = database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO module_links (id, module_id, path, created_at, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [
                "ffffffffffffffffffffffffffffffff".into(),
                STUDIO.into(),
                "/repos/a-third".into(),
            ],
        ))
        .await;
    assert!(direct.is_err(), "a second link for one module was stored");
    drop(directory);
}

#[tokio::test]
async fn the_write_boundary_refuses_a_path_no_row_may_hold() {
    let (directory, database) = installation().await;
    let store = ModuleLinkStore::new(database.clone());
    for candidate in [
        "",
        " ",
        "relative/path",
        " /repos/ticketry",
        "/repos/../elsewhere",
    ] {
        let refused = store.set(STUDIO, candidate).await;
        assert_eq!(
            refused.err().map(|error| error.code()),
            Some(ModuleLinkErrorCode::InvalidPath),
            "{candidate:?} was accepted",
        );
    }
    assert!(stored_paths(&database).await.is_empty());
    drop(directory);
}

#[tokio::test]
async fn an_import_refuses_invalid_paths_and_unknown_modules_without_storing_them() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "relative/studio"}},
                    {{"module_id": "{ABSENT_MODULE}", "path": "/repos/gone"}},
                    {{"module_id": "{TASK}", "path": "/repos/a-task-is-not-a-module"}},
                    {{"module_id": "{SERVICE}", "path": "/repos/service"}}
                ]}}
            ]}}"#
        ),
    );

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import the legacy links");

    assert_eq!(outcome.inserted, 1);
    assert_eq!(
        stored_paths(&database).await,
        vec![(SERVICE.to_owned(), "/repos/service".to_owned())]
    );
    let refused = outcome
        .receipt
        .skipped
        .iter()
        .map(|entry| (entry.module_id.as_str(), entry.reason))
        .collect::<BTreeSet<_>>();
    assert_eq!(
        refused,
        BTreeSet::from([
            (STUDIO, SkipReason::InvalidPath),
            (ABSENT_MODULE, SkipReason::UnknownModule),
            (TASK, SkipReason::UnknownModule),
        ])
    );
}

#[tokio::test]
async fn the_selected_profile_settles_a_module_two_profiles_disagree_about() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 1, "profiles": [
                {{"name": "Old", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/stale"}}
                ]}},
                {{"name": "Current", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/current"}}
                ]}}
            ]}}"#
        ),
    );

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import the legacy links");

    assert_eq!(
        stored_paths(&database).await,
        vec![(STUDIO.to_owned(), "/repos/current".to_owned())]
    );
    assert_eq!(
        outcome
            .receipt
            .skipped
            .iter()
            .map(|entry| entry.reason)
            .collect::<Vec<_>>(),
        vec![SkipReason::DuplicateLegacyLink]
    );
}

/// A folder on a volume that is not mounted is still the user's answer.
#[tokio::test]
async fn a_folder_that_is_not_on_this_machine_is_still_imported() {
    let (directory, database) = installation().await;
    let offline = directory.path().join("an-unmounted-volume/studio");
    assert!(!offline.exists());
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "{}"}}
                ]}}
            ]}}"#,
            offline.display()
        ),
    );

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import the legacy links");

    assert_eq!(outcome.inserted, 1);
    assert_eq!(
        stored_paths(&database).await,
        vec![(STUDIO.to_owned(), offline.display().to_string())]
    );
}

#[tokio::test]
async fn repeating_an_import_changes_neither_a_row_nor_the_receipt() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/studio"}}
                ]}}
            ]}}"#
        ),
    );

    let first = module_links::import(&database, directory.path())
        .await
        .expect("import once");
    let receipt_path = ImportReceipt::path(directory.path());
    let after_first = std::fs::read(&receipt_path).expect("read the receipt");
    let rows_after_first = stored_paths(&database).await;

    let second: ImportOutcome = module_links::import(&database, directory.path())
        .await
        .expect("import again");

    assert_eq!(first.inserted, 1);
    assert_eq!(second.inserted, 0);
    assert!(!second.receipt_changed, "the receipt was rewritten");
    assert_eq!(first.receipt, second.receipt);
    assert_eq!(
        std::fs::read(&receipt_path).expect("re-read the receipt"),
        after_first
    );
    assert_eq!(stored_paths(&database).await, rows_after_first);
}

#[tokio::test]
async fn an_import_keeps_a_folder_the_user_changed_afterwards() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/legacy"}}
                ]}}
            ]}}"#
        ),
    );
    module_links::import(&database, directory.path())
        .await
        .expect("import once");
    ModuleLinkStore::new(database.clone())
        .set(STUDIO, "/repos/chosen-by-the-user")
        .await
        .expect("change the folder");

    let repeated = module_links::import(&database, directory.path())
        .await
        .expect("import again");

    assert_eq!(repeated.inserted, 0);
    assert_eq!(
        stored_paths(&database).await,
        vec![(STUDIO.to_owned(), "/repos/chosen-by-the-user".to_owned())]
    );
    assert_eq!(
        repeated.receipt.links[0].status,
        LinkStatus::Retained,
        "the stored choice must be reported as kept, not as imported"
    );
}

#[tokio::test]
async fn a_rollback_removes_only_what_it_imported_and_leaves_the_profile_file() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/studio"}},
                    {{"module_id": "{SERVICE}", "path": "/repos/service"}}
                ]}}
            ]}}"#
        ),
    );
    let before = std::fs::read(directory.path().join("profiles.json")).expect("read the profiles");
    module_links::import(&database, directory.path())
        .await
        .expect("import the legacy links");
    ModuleLinkStore::new(database.clone())
        .set(SERVICE, "/repos/moved-by-the-user")
        .await
        .expect("change one folder");

    let rolled_back = module_links::rollback(&database, directory.path())
        .await
        .expect("roll the import back");

    assert_eq!(rolled_back.removed, vec![STUDIO.to_owned()]);
    assert_eq!(rolled_back.retained, vec![SERVICE.to_owned()]);
    assert_eq!(
        stored_paths(&database).await,
        vec![(SERVICE.to_owned(), "/repos/moved-by-the-user".to_owned())]
    );
    assert!(!ImportReceipt::path(directory.path()).exists());
    assert_eq!(
        std::fs::read(directory.path().join("profiles.json")).expect("re-read the profiles"),
        before,
        "the only recoverable copy of the legacy configuration changed"
    );

    // The legacy source is still importable, so the rollback is not one-way.
    let reimported = module_links::import(&database, directory.path())
        .await
        .expect("re-import after the rollback");
    assert_eq!(reimported.inserted, 1);
}

#[tokio::test]
async fn an_import_reads_the_preserved_snapshot_when_the_live_file_is_gone() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        legacy_source::PRESERVED_PROFILES[0],
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic", "module_links": [
                    {{"module_id": "{STUDIO}", "path": "/repos/from-the-snapshot"}}
                ]}}
            ]}}"#
        ),
    );

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import from the preserved snapshot");

    assert_eq!(
        outcome
            .receipt
            .source
            .as_ref()
            .map(|source| source.name.as_str()),
        Some(legacy_source::PRESERVED_PROFILES[0])
    );
    assert_eq!(
        stored_paths(&database).await,
        vec![(STUDIO.to_owned(), "/repos/from-the-snapshot".to_owned())]
    );
}

/// The historical `module_folders` spelling is what an older installation has.
#[tokio::test]
async fn an_import_reads_the_historical_module_folders_spelling() {
    let (directory, database) = installation().await;
    write_profiles(
        directory.path(),
        "profiles.json",
        &format!(
            r#"{{"recent_profile_index": 0, "profiles": [
                {{"name": "Local", "workspace_slug": "tic",
                  "module_folders": {{"{STUDIO}": "/repos/older-shape"}}}}
            ]}}"#
        ),
    );

    module_links::import(&database, directory.path())
        .await
        .expect("import the historical shape");

    assert_eq!(
        stored_paths(&database).await,
        vec![(STUDIO.to_owned(), "/repos/older-shape".to_owned())]
    );
}

#[tokio::test]
async fn a_malformed_profile_file_imports_nothing_at_all() {
    let (directory, database) = installation().await;
    write_profiles(directory.path(), "profiles.json", "{ not json");

    let refused = module_links::import(&database, directory.path()).await;

    assert_eq!(
        refused.err().map(|error| error.code()),
        Some(ModuleLinkErrorCode::UnreadableLegacySource)
    );
    assert!(stored_paths(&database).await.is_empty());
    assert!(!ImportReceipt::path(directory.path()).exists());
}

#[tokio::test]
async fn an_installation_with_no_profile_file_imports_nothing_and_reports_it() {
    let (directory, database) = installation().await;

    let outcome = module_links::import(&database, directory.path())
        .await
        .expect("import from an installation with no profile file");

    assert_eq!(outcome.inserted, 0);
    assert!(outcome.receipt.source.is_none());
    assert!(outcome.receipt.links.is_empty());
    assert!(stored_paths(&database).await.is_empty());
}

#[tokio::test]
async fn deleting_a_module_takes_its_link_with_it() {
    let (directory, database) = installation().await;
    ModuleLinkStore::new(database.clone())
        .set(STUDIO, "/repos/studio")
        .await
        .expect("record a folder");

    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "DELETE FROM worktracker_issue WHERE id = ?",
            [STUDIO.into()],
        ))
        .await
        .expect("delete the module");

    assert!(stored_paths(&database).await.is_empty());
    drop(directory);
}

#[tokio::test]
async fn the_installed_schema_is_the_one_the_ownership_manifest_declares() {
    let (directory, database) = installation().await;

    // Installing twice is a no-op rather than a migration.
    schema::install(&database)
        .await
        .expect("install the schema again");
    schema::verify(&database)
        .await
        .expect("verify the installed schema");

    for (table, columns) in ownership_manifest::OWNED_TABLES {
        let installed = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await
            .expect("read the installed columns")
            .iter()
            .map(|row| row.try_get::<String>("", "name").expect("column name"))
            .collect::<BTreeSet<_>>();
        assert_eq!(
            installed,
            columns
                .iter()
                .copied()
                .map(str::to_owned)
                .collect::<BTreeSet<_>>(),
            "{table} does not match its manifest",
        );
    }
    drop(directory);
}

/// The tables are Rust-authored, so no supported source generation may carry
/// them. If one did, classification would have to decide whether an incoming
/// installation's rows were ours, and a PostgreSQL import would stage them.
#[test]
fn no_supported_django_generation_or_postgresql_staging_schema_carries_these_tables() {
    let staging = std::fs::read_to_string(
        crate_root()
            .join("crates/ticketry-installation/src/import/postgres-staging-schemas.v1.json"),
    )
    .expect("read the checked PostgreSQL staging catalog");
    let provisioning = std::fs::read_to_string(
        crate_root().join("crates/ticketry-installation/src/adoption/provisioning.v1.sql"),
    )
    .expect("read the checked fresh-provisioning schema");
    let classification = ticketry_installation::classification::manifest();

    for table in ownership_manifest::owned_tables() {
        assert!(
            !classification.current_tables.contains_key(table),
            "{table} is recorded as a Django-owned product table"
        );
        assert!(
            !staging.contains(table),
            "{table} is staged by a PostgreSQL import"
        );
        assert!(
            !provisioning.contains(table),
            "{table} is provisioned as part of the Django-shaped schema"
        );
    }
}

/// The regression this guards is a quiet one: an importer that falls back to
/// the established data directory would rewrite the user's live installation
/// from a test, a preflight, or a staged import target.
#[test]
fn no_importer_reaches_a_database_its_caller_did_not_name() {
    let mut sources = Vec::new();
    collect_rust_sources(
        &crate_root().join("crates/ticketry-work-management/src/module_links"),
        &mut sources,
    );
    assert!(
        sources.len() >= 8,
        "the capability's sources were not found"
    );

    for path in sources {
        let source = std::fs::read_to_string(&path).expect("read a capability source");
        for forbidden in [
            "Database::connect",
            "ConnectOptions::new",
            "established_data_directory",
            "open_established",
            "state_database_path",
        ] {
            assert!(
                !source.contains(forbidden),
                "{} opens or resolves a database itself via {forbidden}",
                path.display()
            );
        }
    }
}

fn collect_rust_sources(directory: &Path, found: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(directory).expect("readable source directory") {
        let path = entry.expect("readable source entry").path();
        if path.is_dir() {
            collect_rust_sources(&path, found);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn a_link_identity_is_derived_from_its_module_rather_than_minted() {
    let first = identity::link_id_for_module(STUDIO);
    let second = identity::link_id_for_module(STUDIO);
    assert_eq!(first, second);
    assert_ne!(first, identity::link_id_for_module(SERVICE));
}

#[test]
fn a_persistable_path_is_absolute_and_carries_no_surrounding_whitespace() {
    assert!(LocalModulePath::parse("/repos/ticketry").is_ok());
    assert!(LocalModulePath::parse("repos/ticketry").is_err());
    assert!(LocalModulePath::parse("/repos/ticketry ").is_err());
    assert!(LocalModulePath::parse("/repos/../ticketry").is_err());
    assert!(LocalModulePath::parse("").is_err());
}

// ---------------------------------------------------------------------------
// The public contract
// ---------------------------------------------------------------------------

/// The Module Link contract, built the way the product schema builds it.
async fn contract_sdl() -> String {
    use seaography::{
        async_graphql::dynamic::{Object, Schema},
        Builder, BuilderContext,
    };
    use ticketry_entities::runs::agent_run;

    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open the contract audit store");
    let context = Box::leak(Box::new(BuilderContext::default()));
    let mut builder = Builder::new(context, database);
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);
    let mut builder = ticketry_entities::work_management::register_entity_modules(builder);
    // The Work Item graph names Agent Runs, so the read graph only closes once
    // that entity is registered alongside it.
    seaography::register_entity!(builder, agent_run, mutation: false);
    ticketry_work_management::module_links::register_graphql(builder)
        .schema_builder()
        .finish()
        .expect("build the Module Link contract")
        .sdl()
}

async fn executable_contract(
    database: DatabaseConnection,
    writable: bool,
) -> seaography::async_graphql::dynamic::Schema {
    use seaography::{
        async_graphql::dynamic::{Object, Schema},
        Builder, BuilderContext,
    };
    use ticketry_entities::runs::agent_run;

    let context = Box::leak(Box::new(BuilderContext::default()));
    let mut builder = Builder::new(context, database.clone());
    builder.mutation = Object::new("Mutation");
    builder.schema = Schema::build("Query", Some("Mutation"), None);
    let mut builder = ticketry_entities::work_management::register_entity_modules(builder);
    seaography::register_entity!(builder, agent_run, mutation: false);
    let builder = ticketry_work_management::module_links::register_graphql(builder);
    let mut schema = builder.schema_builder().data(database.clone());
    if writable {
        schema = schema
            .data(ticketry_work_management::work_management::commands::CommandDatabase(database));
    }
    schema
        .finish()
        .expect("build the executable Module Link contract")
}

async fn execute_contract(
    schema: &seaography::async_graphql::dynamic::Schema,
    query: &str,
    variables: serde_json::Value,
) -> serde_json::Value {
    use seaography::async_graphql::{Request, Variables};

    serde_json::to_value(
        schema
            .execute(Request::new(query).variables(Variables::from_json(variables)))
            .await,
    )
    .expect("encode the Module Link GraphQL response")
}

async fn stored_link(
    database: &DatabaseConnection,
    module_id: &str,
) -> Option<(
    String,
    String,
    sea_orm::prelude::DateTime,
    sea_orm::prelude::DateTime,
)> {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT id, path, created_at, updated_at FROM module_links WHERE module_id = ?"
                .to_owned(),
            [module_id.into()],
        ))
        .await
        .expect("read the stored Module Link")
        .map(|row| {
            (
                row.try_get("", "id").expect("link id"),
                row.try_get("", "path").expect("link path"),
                row.try_get("", "created_at").expect("created timestamp"),
                row.try_get("", "updated_at").expect("updated timestamp"),
            )
        })
}

const SET_LINK: &str = r#"
    mutation SetModuleLink($moduleId: String!, $path: String!) {
      set_module_link(module_id: $moduleId, link: { path: $path }) {
        id
        moduleId
        path
        createdAt
        updatedAt
      }
    }
"#;

#[tokio::test]
async fn set_view_derives_server_fields_and_returns_the_persisted_row() {
    let (directory, database) = installation().await;
    let first_folder = directory.path().join("first");
    let second_folder = directory.path().join("second");
    std::fs::create_dir(&first_folder).expect("create the first linked folder");
    std::fs::create_dir(&second_folder).expect("create the second linked folder");
    let schema = executable_contract(database.clone(), true).await;

    let first = execute_contract(
        &schema,
        SET_LINK,
        serde_json::json!({"moduleId": STUDIO, "path": first_folder}),
    )
    .await;
    assert!(first.get("errors").is_none(), "{first:#}");
    let first_result = &first["data"]["set_module_link"];
    let first_stored = stored_link(&database, STUDIO)
        .await
        .expect("stored first link");
    assert_eq!(first_result["id"], identity::link_id_for_module(STUDIO));
    assert_eq!(first_result["moduleId"], STUDIO);
    assert_eq!(first_result["path"], first_stored.1);
    assert_eq!(first_result["id"], first_stored.0);

    tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    let second = execute_contract(
        &schema,
        SET_LINK,
        serde_json::json!({"moduleId": STUDIO, "path": second_folder}),
    )
    .await;
    assert!(second.get("errors").is_none(), "{second:#}");
    let second_result = &second["data"]["set_module_link"];
    let second_stored = stored_link(&database, STUDIO)
        .await
        .expect("stored second link");
    assert_eq!(second_result["id"], first_result["id"]);
    assert_eq!(second_result["createdAt"], first_result["createdAt"]);
    assert_ne!(second_result["updatedAt"], first_result["updatedAt"]);
    assert_eq!(second_result["path"], second_stored.1);
    assert_eq!(second_stored.0, first_stored.0);
    assert_eq!(second_stored.2, first_stored.2);
    assert!(second_stored.3 > first_stored.3);
}

#[tokio::test]
async fn set_view_preserves_folder_module_and_ownership_errors() {
    let (directory, database) = installation().await;
    let schema = executable_contract(database.clone(), true).await;
    let missing = directory.path().join("missing");
    let invalid_folder = execute_contract(
        &schema,
        SET_LINK,
        serde_json::json!({"moduleId": STUDIO, "path": missing}),
    )
    .await;
    assert_eq!(
        invalid_folder["errors"][0]["extensions"]["code"],
        "module_link_folder_invalid"
    );

    let unknown_module = execute_contract(
        &schema,
        SET_LINK,
        serde_json::json!({"moduleId": ABSENT_MODULE, "path": directory.path()}),
    )
    .await;
    assert_eq!(
        unknown_module["errors"][0]["extensions"]["code"],
        "module_link_module_unknown"
    );

    let unavailable_schema = executable_contract(database, false).await;
    let unavailable = execute_contract(
        &unavailable_schema,
        SET_LINK,
        serde_json::json!({"moduleId": STUDIO, "path": directory.path()}),
    )
    .await;
    assert_eq!(
        unavailable["errors"][0]["extensions"]["code"],
        "module_link_write_unavailable"
    );
}

#[tokio::test]
async fn clear_view_reports_presence_and_is_idempotent() {
    let (directory, database) = installation().await;
    ModuleLinkStore::new(database.clone())
        .set(STUDIO, "/repos/studio")
        .await
        .expect("seed one Module Link");
    let schema = executable_contract(database.clone(), true).await;
    let clear = r#"mutation ClearModuleLink($moduleId: String!) {
        clear_module_link(module_id: $moduleId)
    }"#;

    let removed = execute_contract(&schema, clear, serde_json::json!({"moduleId": STUDIO})).await;
    let repeated = execute_contract(&schema, clear, serde_json::json!({"moduleId": STUDIO})).await;

    assert_eq!(removed["data"]["clear_module_link"], true);
    assert_eq!(repeated["data"]["clear_module_link"], false);
    assert!(stored_link(&database, STUDIO).await.is_none());
    drop(directory);
}

#[tokio::test]
async fn the_contract_publishes_the_generated_read_graph() {
    let sdl = contract_sdl().await;

    assert!(sdl.contains("type ModuleLinks"), "{sdl}");
    assert!(sdl.contains("moduleLinks("), "{sdl}");
}

/// Every generated write stays private: none of them can bind one Module,
/// derive the identity, or preserve `created_at` across a re-link.
#[tokio::test]
async fn the_contract_publishes_no_generated_write() {
    let sdl = contract_sdl().await;

    for operation in ["CreateOne", "CreateBatch", "Update", "Delete"] {
        assert!(
            !sdl.contains(&format!("moduleLinks{operation}(")),
            "generated {operation} is public: {sdl}"
        );
    }
}

/// The authorization shape of the write surface: the Module is bound as a
/// non-null argument, and the input carries the local path and nothing else.
#[tokio::test]
async fn every_public_write_binds_its_module_and_allowlists_only_the_path() {
    let sdl = contract_sdl().await;

    assert!(
        sdl.contains("set_module_link(module_id: String!, link: ModuleLinkPathInput!)"),
        "{sdl}"
    );
    assert!(
        sdl.contains("clear_module_link(module_id: String!)"),
        "{sdl}"
    );

    let input = sdl
        .split("input ModuleLinkPathInput {")
        .nth(1)
        .expect("the path input")
        .split('}')
        .next()
        .unwrap();
    assert!(input.contains("path: String!"), "{input}");
    for protected in ["id:", "module_id:", "created_at:", "updated_at:"] {
        assert!(!input.contains(protected), "exposed {protected} in {input}");
    }
}
