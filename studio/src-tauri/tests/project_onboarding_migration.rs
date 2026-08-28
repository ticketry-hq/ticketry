//! Onboarding moves onto Project and the Workspace table leaves the schema.
//!
//! Source commit `3a5f434a90696f40a4911e401a84db009cdfa4e7`, migrations
//! `0045_project_onboarding_required` and `0046_remove_workspace`.

use muxed_studio_lib::work_management::project_onboarding_migration::{
    install, LEDGER_TABLE, MIGRATION_ID, SOURCE_COMMIT, VERSION,
};
use muxed_studio_lib::{
    graphql_foundation::initialize_with_worktracker_commands_and_install,
    installation::adoption::provisioning,
    work_management::{commands::catalog, open_for_commands},
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use tauri_graphql::TransportApiImpl;

const WORKSPACE_SHAPED_SCHEMA: &str = "
    CREATE TABLE worktracker_workspace (
        id char(32) NOT NULL PRIMARY KEY,
        slug varchar(255) NOT NULL UNIQUE,
        name varchar(255) NOT NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        onboarding_required bool NOT NULL
    );
    CREATE TABLE worktracker_project (
        id char(32) NOT NULL PRIMARY KEY,
        name varchar(255) NOT NULL,
        slug varchar(64) NOT NULL,
        description text NOT NULL,
        seq_counter integer NOT NULL,
        created_at datetime NOT NULL,
        updated_at datetime NOT NULL,
        workspace_id char(32) NOT NULL REFERENCES worktracker_workspace (id),
        state_revision bigint NOT NULL,
        manual_module_order bool NOT NULL
    );
    CREATE INDEX worktracker_project_workspace_id_7196ac72
        ON worktracker_project (workspace_id);
    CREATE UNIQUE INDEX worktracker_project_workspace_id_slug_80399ba5_uniq
        ON worktracker_project (workspace_id, slug);
";

/// One project row as `(id, slug, created_at, workspace_id)`.
type ProjectSeed = (&'static str, &'static str, &'static str, &'static str);

async fn workspace_shaped(
    workspaces: &[(&str, &str, bool)],
    projects: &[ProjectSeed],
) -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open migration fixture");
    database
        .execute_unprepared(WORKSPACE_SHAPED_SCHEMA)
        .await
        .expect("create the Workspace-shaped schema");
    for (id, slug, onboarding_required) in workspaces {
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO worktracker_workspace
                 (id, slug, name, created_at, updated_at, onboarding_required)
                 VALUES (?, ?, ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00', ?)",
                [
                    (*id).into(),
                    (*slug).into(),
                    (*slug).into(),
                    (*onboarding_required).into(),
                ],
            ))
            .await
            .expect("seed a workspace");
    }
    for (id, slug, created_at, workspace_id) in projects {
        database
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "INSERT INTO worktracker_project
                 (id, name, slug, description, seq_counter, created_at, updated_at,
                  workspace_id, state_revision, manual_module_order)
                 VALUES (?, ?, ?, '', 0, ?, ?, ?, 0, 0)",
                [
                    (*id).into(),
                    (*slug).into(),
                    (*slug).into(),
                    (*created_at).into(),
                    (*created_at).into(),
                    (*workspace_id).into(),
                ],
            ))
            .await
            .expect("seed a project");
    }
    database
}

async fn projects(database: &DatabaseConnection) -> Vec<(String, String, bool)> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, slug, onboarding_required FROM worktracker_project ORDER BY id".to_owned(),
        ))
        .await
        .expect("read migrated projects")
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "id").expect("project id"),
                row.try_get::<String>("", "slug").expect("project slug"),
                row.try_get::<i32>("", "onboarding_required")
                    .expect("project onboarding")
                    != 0,
            )
        })
        .collect()
}

async fn table_exists(database: &DatabaseConnection, table: &str) -> bool {
    database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .expect("read sqlite_master")
        .expect("count row")
        .try_get::<i64>("", "count")
        .expect("decode count")
        == 1
}

async fn columns(database: &DatabaseConnection, table: &str) -> Vec<String> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .expect("read table info")
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").expect("column name"))
        .collect()
}

async fn indexes(database: &DatabaseConnection, table: &str) -> Vec<String> {
    database
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? ORDER BY name",
            [table.into()],
        ))
        .await
        .expect("read indexes")
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").expect("index name"))
        .collect()
}

#[tokio::test]
async fn the_final_schema_has_no_workspace_table_or_project_foreign_key() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[("p1", "CDN", "2026-02-01 00:00:00", "w1")],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert!(!table_exists(&database, "worktracker_workspace").await);
    let project_columns = columns(&database, "worktracker_project").await;
    assert!(!project_columns.contains(&"workspace_id".to_owned()));
    assert!(project_columns.contains(&"onboarding_required".to_owned()));
    let project_indexes = indexes(&database, "worktracker_project").await;
    assert!(project_indexes
        .iter()
        .all(|index| !index.contains("workspace")));
    assert!(project_indexes.contains(&"worktracker_project_slug_key".to_owned()));
    assert!(database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .expect("run the foreign-key check")
        .is_empty());
}

#[tokio::test]
async fn the_preferred_installation_slug_receives_pending_onboarding() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[
            ("p1", "OLD", "2026-01-01 00:00:00", "w1"),
            ("p2", "CODING", "2026-02-01 00:00:00", "w1"),
            ("p3", "CDN", "2026-03-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert_eq!(
        projects(&database).await,
        vec![
            ("p1".to_owned(), "OLD".to_owned(), false),
            ("p2".to_owned(), "CODING".to_owned(), false),
            ("p3".to_owned(), "CDN".to_owned(), true),
        ]
    );
}

#[tokio::test]
async fn the_legacy_slug_receives_onboarding_when_the_current_one_is_absent() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[
            ("p1", "OLD", "2026-01-01 00:00:00", "w1"),
            ("p2", "CODING", "2026-02-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert_eq!(
        projects(&database).await,
        vec![
            ("p1".to_owned(), "OLD".to_owned(), false),
            ("p2".to_owned(), "CODING".to_owned(), true),
        ]
    );
}

#[tokio::test]
async fn an_unrecognized_installation_falls_back_to_its_oldest_project() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[
            ("p2", "TWO", "2026-02-01 00:00:00", "w1"),
            ("p1", "ONE", "2026-01-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert_eq!(
        projects(&database).await,
        vec![
            ("p1".to_owned(), "ONE".to_owned(), true),
            ("p2".to_owned(), "TWO".to_owned(), false),
        ]
    );
}

#[tokio::test]
async fn projects_sharing_a_creation_time_break_the_tie_on_identity() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[
            ("p2", "TWO", "2026-01-01 00:00:00", "w1"),
            ("p1", "ONE", "2026-01-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert_eq!(
        projects(&database).await,
        vec![
            ("p1".to_owned(), "ONE".to_owned(), true),
            ("p2".to_owned(), "TWO".to_owned(), false),
        ]
    );
}

#[tokio::test]
async fn a_single_project_installation_receives_pending_onboarding() {
    let database = workspace_shaped(
        &[("w1", "meml", true)],
        &[("only", "ANY", "2026-01-01 00:00:00", "w1")],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert_eq!(
        projects(&database).await,
        vec![("only".to_owned(), "ANY".to_owned(), true)]
    );
}

#[tokio::test]
async fn an_acknowledged_workspace_never_turns_onboarding_back_on() {
    let database = workspace_shaped(
        &[("w1", "meml", false)],
        &[
            ("p1", "CDN", "2026-01-01 00:00:00", "w1"),
            ("p2", "OTHER", "2026-02-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    assert!(projects(&database)
        .await
        .iter()
        .all(|(_, _, onboarding_required)| !onboarding_required));
}

#[tokio::test]
async fn an_installation_with_no_project_still_removes_workspace() {
    let database = workspace_shaped(&[("w1", "meml", true)], &[]).await;

    install(&database).await.expect("migrate the installation");

    assert!(!table_exists(&database, "worktracker_workspace").await);
    assert!(table_exists(&database, LEDGER_TABLE).await);
    assert!(projects(&database).await.is_empty());
}

#[tokio::test]
async fn duplicate_slugs_are_suffixed_deterministically_and_no_project_is_lost() {
    // Slugs were unique per workspace, so a collision can only arrive from
    // projects that lived under different workspaces.
    let database = workspace_shaped(
        &[("w1", "one", true), ("w2", "two", false), ("w3", "three", false)],
        &[
            ("p1", "CDN", "2026-01-01 00:00:00", "w1"),
            ("p2", "CDN", "2026-02-01 00:00:00", "w2"),
            ("p3", "CDN", "2026-03-01 00:00:00", "w3"),
            ("p4", "CDN-2", "2026-04-01 00:00:00", "w1"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");

    // p1 is earliest so it keeps CDN and, being the installation project, takes
    // the pending onboarding. CDN-2 is already spoken for, so p2 takes the next
    // free ordinal and p3 the one after it.
    assert_eq!(
        projects(&database).await,
        vec![
            ("p1".to_owned(), "CDN".to_owned(), true),
            ("p2".to_owned(), "CDN-3".to_owned(), false),
            ("p3".to_owned(), "CDN-4".to_owned(), false),
            ("p4".to_owned(), "CDN-2".to_owned(), false),
        ]
    );
    assert!(indexes(&database, "worktracker_project")
        .await
        .contains(&"worktracker_project_slug_key".to_owned()));
}

#[tokio::test]
async fn a_repeated_startup_is_a_no_op_over_a_durable_migration_identity() {
    // Acknowledgement takes a real project identity, so this fixture uses the
    // installation's own id shape rather than a readable placeholder.
    const INSTALLATION: &str = "00000000000000000000000000000001";
    let database = workspace_shaped(
        &[("w1", "meml", true), ("w2", "other", false)],
        &[
            (INSTALLATION, "CDN", "2026-01-01 00:00:00", "w1"),
            ("00000000000000000000000000000002", "CDN", "2026-02-01 00:00:00", "w2"),
        ],
    )
    .await;

    install(&database).await.expect("migrate the installation");
    let migrated = projects(&database).await;
    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, migration_id, source_commit FROM {LEDGER_TABLE} \
                 WHERE singleton = 1"
            ),
        ))
        .await
        .expect("read the migration ledger")
        .expect("ledger row");
    assert_eq!(ledger.try_get::<i32>("", "version").expect("version"), VERSION);
    assert_eq!(
        ledger
            .try_get::<String>("", "migration_id")
            .expect("migration id"),
        MIGRATION_ID
    );
    assert_eq!(
        ledger
            .try_get::<String>("", "source_commit")
            .expect("source commit"),
        SOURCE_COMMIT
    );

    // Acknowledging first proves the repeat run reads the ledger instead of
    // re-transferring a Workspace value that no longer exists.
    catalog::acknowledge_onboarding(&database, INSTALLATION)
        .await
        .expect("acknowledge the migrated onboarding");
    install(&database).await.expect("repeat the startup");

    assert_eq!(
        projects(&database).await,
        migrated
            .into_iter()
            .map(|(id, slug, _)| (id, slug, false))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_failed_migration_rolls_back_every_schema_change_and_the_ledger() {
    let database = workspace_shaped(
        &[("w1", "meml", true), ("w2", "other", false)],
        &[
            ("p1", "CDN", "2026-01-01 00:00:00", "w1"),
            ("p2", "CDN", "2026-02-01 00:00:00", "w2"),
        ],
    )
    .await;
    database
        .execute_unprepared(
            "CREATE TRIGGER fail_project_slug BEFORE UPDATE OF slug ON worktracker_project
             BEGIN SELECT RAISE(ABORT, 'injected slug migration failure'); END",
        )
        .await
        .expect("install a deterministic migration fault");

    let failure = install(&database).await;

    assert!(failure.is_err(), "the injected fault must fail the run");
    assert!(!table_exists(&database, LEDGER_TABLE).await);
    assert!(table_exists(&database, "worktracker_workspace").await);
    let project_columns = columns(&database, "worktracker_project").await;
    assert!(project_columns.contains(&"workspace_id".to_owned()));
    assert!(!project_columns.contains(&"onboarding_required".to_owned()));
    assert!(indexes(&database, "worktracker_project")
        .await
        .contains(&"worktracker_project_workspace_id_7196ac72".to_owned()));
}

#[tokio::test]
async fn the_migration_only_touches_the_connection_it_is_given() {
    let directory = tempfile::tempdir().expect("create alternate database directory");
    let mut connections = Vec::new();
    for name in ["migrated.db", "untouched.db"] {
        let path = directory.path().join(name);
        let database = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
            .await
            .expect("open an alternate database");
        database
            .execute_unprepared(WORKSPACE_SHAPED_SCHEMA)
            .await
            .expect("create the Workspace-shaped schema");
        database
            .execute_unprepared(
                "INSERT INTO worktracker_workspace VALUES
                     ('w1', 'meml', 'meml', '2026-01-01 00:00:00', '2026-01-01 00:00:00', 1);
                 INSERT INTO worktracker_project
                     (id, name, slug, description, seq_counter, created_at, updated_at,
                      workspace_id, state_revision, manual_module_order)
                 VALUES ('p1', 'Coding', 'CDN', '', 0, '2026-01-01 00:00:00',
                         '2026-01-01 00:00:00', 'w1', 0, 0);",
            )
            .await
            .expect("seed an alternate database");
        connections.push(database);
    }
    let untouched = connections.pop().expect("the second database");
    let migrated = connections.pop().expect("the first database");

    install(&migrated).await.expect("migrate one database");

    assert!(!table_exists(&migrated, "worktracker_workspace").await);
    assert!(table_exists(&untouched, "worktracker_workspace").await);
    assert!(!table_exists(&untouched, LEDGER_TABLE).await);
    assert!(columns(&untouched, "worktracker_project")
        .await
        .contains(&"workspace_id".to_owned()));
}

/// Start the production runtime against an installation, the way a launch does.
async fn start_runtime(directory: &std::path::Path, api: &TransportApiImpl) {
    let _runtime = initialize_with_worktracker_commands_and_install(
        &directory.join("rust-core.sqlite3"),
        &directory.join("state.db"),
        &directory.join("media"),
        api,
    )
    .await
    .expect("open the production GraphQL runtime");
}

#[tokio::test]
async fn a_fresh_installation_starts_up_project_only_and_owns_its_onboarding() {
    let directory = tempfile::tempdir().expect("create fresh installation");
    provisioning::provision(directory.path())
        .await
        .expect("provision a fresh installation");

    let api = TransportApiImpl::new();
    start_runtime(directory.path(), &api).await;

    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .expect("open the migrated installation");
    assert!(!table_exists(&database, "worktracker_workspace").await);
    assert!(table_exists(&database, LEDGER_TABLE).await);

    // A first launch arrives with the installation project already present and
    // still asking to be onboarded. Nothing creates it after startup, so the
    // welcome the user sees is bound to a project that already has an identity.
    let installed = projects(&database).await;
    let [(_, slug, onboarding_required)] = installed.as_slice() else {
        panic!("a first launch must hold exactly one project, found {installed:?}");
    };
    assert_eq!(slug, "CDN");
    assert!(
        onboarding_required,
        "a first launch has not been onboarded yet"
    );

    // Rust and MCP must name that same project.
    assert_eq!(
        muxed_studio_lib::work_management::read_queries::installation_project(&database)
            .await
            .expect("resolve the installation project")
            .expect("a first launch has an installation project")
            .slug,
        "CDN"
    );

    catalog::create_project(
        &database,
        catalog::CreateProject {
            name: "Duplicate".to_owned(),
            slug: "CDN".to_owned(),
            description: None,
        },
    )
    .await
    .expect_err("project slugs are globally unique after the migration");
}

#[tokio::test]
async fn acknowledging_a_first_launch_clears_onboarding_and_survives_a_reload() {
    let directory = tempfile::tempdir().expect("create fresh installation");
    provisioning::provision(directory.path())
        .await
        .expect("provision a fresh installation");
    let api = TransportApiImpl::new();
    start_runtime(directory.path(), &api).await;

    let state_path = directory.path().join("state.db");
    let database = open_for_commands(&state_path)
        .await
        .expect("open the migrated installation");
    let (project_id, _, _) = projects(&database).await.remove(0);

    catalog::acknowledge_onboarding(&database, &project_id)
        .await
        .expect("acknowledge the welcome the first launch showed");
    assert_eq!(
        projects(&database).await,
        vec![(project_id.clone(), "CDN".to_owned(), false)],
        "acknowledgement clears onboarding on the project it was shown for"
    );
    drop(database);

    // Reload: a second startup re-runs the migration, which must be a no-op
    // rather than resurrecting the welcome the user already dismissed.
    let reloaded_api = TransportApiImpl::new();
    start_runtime(directory.path(), &reloaded_api).await;

    let reloaded = open_for_commands(&state_path)
        .await
        .expect("reopen the installation");
    assert_eq!(
        projects(&reloaded).await,
        vec![(project_id, "CDN".to_owned(), false)],
        "a reload must not ask an onboarded installation to onboard again"
    );
}

#[tokio::test]
async fn the_migration_ledger_is_a_recognized_rust_ownership_ledger() {
    assert!(
        muxed_studio_lib::installation::classification::rust_ledger::owned_ledgers()
            .iter()
            .any(|(table, version)| *table == LEDGER_TABLE && *version == VERSION),
        "classification must recognize the project-onboarding ledger"
    );
}
