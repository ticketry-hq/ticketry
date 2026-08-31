use muxed_studio_lib::{
    graphql_foundation::initialize_with_worktracker_commands_and_install,
    installation::adoption::provisioning,
};
use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_work_management::work_management::workflow_color_migration::{
    install, LEDGER_TABLE, MIGRATION_ID, SOURCE_COMMIT,
};
use ticketry_work_management::work_management::{
    commands::catalog::{self, CreateProject},
    module_presentation_migration, open_for_commands, project_onboarding_migration,
};

async fn mixed_database() -> sea_orm::DatabaseConnection {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open adoption fixture");
    database
        .execute_unprepared(
            "CREATE TABLE worktracker_state (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT NULL,
                untouched TEXT NOT NULL
            );
            INSERT INTO worktracker_state (id, project_id, name, color, untouched) VALUES
                ('ideas-a', 'project-a', 'Ideas', '#D12771', 'ideas-a'),
                ('grill-a', 'project-a', 'Grill', '#60646C', 'grill-a'),
                ('review-a', 'project-a', 'Review', '#D6409F', 'review-a'),
                ('ideas-b', 'project-b', 'Ideas', '#D12771', 'ideas-b'),
                ('grill-b', 'project-b', 'Grill', '#60646C', 'grill-b'),
                ('review-b', 'project-b', 'Review', '#D6409F', 'review-b'),
                ('ideas-custom', 'project-a', 'Ideas', '#123456', 'ideas-custom'),
                ('grill-custom', 'project-a', 'Grill', '#234567', 'grill-custom'),
                ('review-custom', 'project-a', 'Review', '#345678', 'review-custom'),
                ('wrong-ideas', 'project-a', 'Unrelated Ideas Color', '#D12771', 'wrong-ideas'),
                ('wrong-grill', 'project-a', 'Unrelated Grill Color', '#60646C', 'wrong-grill'),
                ('wrong-review', 'project-a', 'Unrelated Review Color', '#D6409F', 'wrong-review'),
                ('ideas-null', 'project-a', 'Ideas', NULL, 'ideas-null'),
                ('ideas-current', 'project-a', 'Ideas', '#60646C', 'ideas-current'),
                ('grill-current', 'project-a', 'Grill', '#FA4D56', 'grill-current'),
                ('review-current', 'project-a', 'Review', '#08BDBA', 'review-current');",
        )
        .await
        .expect("seed mixed adoption fixture");
    database
}

async fn rows(database: &sea_orm::DatabaseConnection) -> Vec<(String, Option<String>, String)> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, color, untouched FROM worktracker_state ORDER BY id".to_owned(),
        ))
        .await
        .expect("read adopted states")
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "id").expect("state id"),
                row.try_get("", "color").expect("state color"),
                row.try_get("", "untouched").expect("untouched field"),
            )
        })
        .collect()
}

#[tokio::test]
async fn adopts_only_exact_former_reviewed_defaults_across_projects_and_reopens_stably() {
    let database = mixed_database().await;

    install(&database).await.expect("adopt workflow colors");
    let first = rows(&database).await;
    install(&database)
        .await
        .expect("repeat workflow color adoption");
    let second = rows(&database).await;

    assert_eq!(second, first);
    assert_eq!(
        first,
        vec![
            ("grill-a".into(), Some("#FA4D56".into()), "grill-a".into()),
            ("grill-b".into(), Some("#FA4D56".into()), "grill-b".into()),
            (
                "grill-current".into(),
                Some("#FA4D56".into()),
                "grill-current".into()
            ),
            (
                "grill-custom".into(),
                Some("#234567".into()),
                "grill-custom".into()
            ),
            ("ideas-a".into(), Some("#60646C".into()), "ideas-a".into()),
            ("ideas-b".into(), Some("#60646C".into()), "ideas-b".into()),
            (
                "ideas-current".into(),
                Some("#60646C".into()),
                "ideas-current".into()
            ),
            (
                "ideas-custom".into(),
                Some("#123456".into()),
                "ideas-custom".into()
            ),
            ("ideas-null".into(), None, "ideas-null".into()),
            ("review-a".into(), Some("#08BDBA".into()), "review-a".into()),
            ("review-b".into(), Some("#08BDBA".into()), "review-b".into()),
            (
                "review-current".into(),
                Some("#08BDBA".into()),
                "review-current".into()
            ),
            (
                "review-custom".into(),
                Some("#345678".into()),
                "review-custom".into()
            ),
            (
                "wrong-grill".into(),
                Some("#60646C".into()),
                "wrong-grill".into()
            ),
            (
                "wrong-ideas".into(),
                Some("#D12771".into()),
                "wrong-ideas".into()
            ),
            (
                "wrong-review".into(),
                Some("#D6409F".into()),
                "wrong-review".into()
            ),
        ]
    );

    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT migration_id, source_commit FROM {LEDGER_TABLE} WHERE singleton = 1"),
        ))
        .await
        .expect("read workflow color ledger")
        .expect("workflow color ledger row");
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
}

#[tokio::test]
async fn skips_color_adoption_when_the_worktracker_state_table_is_absent() {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open partial profile fixture");

    install(&database)
        .await
        .expect("install migration without WorkTracker states");
    install(&database)
        .await
        .expect("reopen migration without WorkTracker states");

    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT migration_id FROM {LEDGER_TABLE} WHERE singleton = 1"),
        ))
        .await
        .expect("read workflow color ledger")
        .expect("workflow color ledger row");
    assert_eq!(
        ledger
            .try_get::<String>("", "migration_id")
            .expect("migration id"),
        MIGRATION_ID
    );
}

#[test]
fn workflow_color_checkpoint_follows_entry_skill_in_the_rust_ledger() {
    let ledgers = muxed_studio_lib::installation::classification::rust_ledger::owned_ledgers();
    let entry_skill = ledgers
        .iter()
        .position(|(table, _)| {
            *table
                == ticketry_work_management::work_management::launch_binding_entry_skill_migration::LEDGER_TABLE
        })
        .expect("entry-skill ledger");
    let colors = ledgers
        .iter()
        .position(|(table, _)| *table == LEDGER_TABLE)
        .expect("workflow color ledger");
    assert_eq!(colors, entry_skill + 1);
}

async fn generated_colors(api: &TransportApiImpl, project_id: &str) -> Vec<(String, String)> {
    let response: serde_json::Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(
                serde_json::json!({
                    "query": include_str!("../../src/features/projects/operations/projects.graphql"),
                    "operationName": "WorkTrackerProjectStates",
                    "variables": {"projectId": project_id}
                })
                .to_string(),
            )
            .await,
    )
    .expect("parse generated state response");
    assert!(response.get("errors").is_none(), "{response}");
    response["data"]["states"]["nodes"]
        .as_array()
        .expect("generated state nodes")
        .iter()
        .map(|state| {
            (
                state["name"].as_str().expect("state name").to_owned(),
                state["color"].as_str().expect("state color").to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
async fn production_startup_adopts_old_colors_before_generated_state_reads() {
    let directory = tempfile::tempdir().expect("create upgraded profile");
    provisioning::provision(directory.path())
        .await
        .expect("provision profile schema");
    let state_path = directory.path().join("state.db");
    let database = open_for_commands(&state_path)
        .await
        .expect("open profile database");
    module_presentation_migration::install(&database)
        .await
        .expect("remove the legacy project ordering flag");
    project_onboarding_migration::install(&database)
        .await
        .expect("move onboarding onto the project");
    let project_id = catalog::create_project(
        &database,
        CreateProject {
            name: "Upgraded".to_owned(),
            slug: "UPG".to_owned(),
            description: None,
        },
    )
    .await
    .expect("create upgraded project");
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE worktracker_state SET color = CASE name
                WHEN 'Ideas' THEN '#D12771'
                WHEN 'Grill' THEN '#60646C'
                WHEN 'Review' THEN '#D6409F'
                WHEN 'Spec' THEN '#D12771'
                ELSE color END
             WHERE project_id = ?",
            [project_id.clone().into()],
        ))
        .await
        .expect("restore pre-upgrade colors");
    database.close().await.expect("close pre-upgrade profile");

    let api = TransportApiImpl::new();
    let _runtime = initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state_path,
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("open production GraphQL runtime");

    let colors = generated_colors(&api, &project_id).await;
    assert!(colors.contains(&("Ideas".to_owned(), "#60646C".to_owned())));
    assert!(colors.contains(&("Grill".to_owned(), "#FA4D56".to_owned())));
    assert!(colors.contains(&("Review".to_owned(), "#08BDBA".to_owned())));
    assert!(colors.contains(&("Spec".to_owned(), "#D12771".to_owned())));
}

#[tokio::test]
async fn a_failed_color_update_rolls_back_rows_and_the_ledger() {
    let database = mixed_database().await;
    let before = rows(&database).await;
    database
        .execute_unprepared(
            "CREATE TRIGGER fail_review_color BEFORE UPDATE OF color ON worktracker_state
             WHEN OLD.name = 'Review' BEGIN
                 SELECT RAISE(ABORT, 'injected workflow color failure');
             END",
        )
        .await
        .expect("install deterministic migration fault");

    install(&database)
        .await
        .expect_err("injected Review update must stop adoption");

    assert_eq!(rows(&database).await, before);
    let ledger_tables = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [LEDGER_TABLE.into()],
        ))
        .await
        .expect("inspect rolled-back ledger")
        .expect("ledger count row")
        .try_get::<i64>("", "count")
        .expect("ledger table count");
    assert_eq!(ledger_tables, 0);
}
