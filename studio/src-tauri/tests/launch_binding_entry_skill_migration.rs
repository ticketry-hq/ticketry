use muxed_studio_lib::installation::classification::rust_ledger;
use muxed_studio_lib::work_management::launch_binding_entry_skill_migration::{
    has_entry_skill_column, install, LEDGER_TABLE, MIGRATION_ID, SOURCE_COMMIT, VERSION,
};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

const PRE_ENTRY_SKILL_SCHEMA: &str = r#"
    CREATE TABLE worktracker_state (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        "group" TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
        is_protected BOOL NOT NULL, created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    );
    CREATE TABLE worktracker_issuetype (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        level TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL,
        start_state_id TEXT, workflow_revision INTEGER NOT NULL,
        is_pathfind BOOL NOT NULL, created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    );
    CREATE TABLE worktracker_launchbinding (
        id INTEGER PRIMARY KEY AUTOINCREMENT, issue_type_id TEXT NOT NULL,
        state_id TEXT NOT NULL, prompt TEXT NOT NULL, required_skills TEXT NOT NULL,
        model_id TEXT, reasoning_id TEXT, auto_start BOOL NOT NULL,
        subtree_run_enabled BOOL NOT NULL, created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL, UNIQUE(issue_type_id, state_id)
    );
"#;

async fn fixture() -> DatabaseConnection {
    let database = Database::connect("sqlite::memory:")
        .await
        .expect("open entry-skill migration fixture");
    database
        .execute_unprepared(PRE_ENTRY_SKILL_SCHEMA)
        .await
        .expect("create pre-entry-skill schema");
    database
        .execute_unprepared(
            r#"
            INSERT INTO worktracker_state VALUES
                ('spec', 'project', 'Spec', 'unstarted', '', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('grill', 'project', 'Grill', 'backlog', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('tickets', 'project', 'Tickets', 'unstarted', '', 2, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype VALUES
                ('story', 'project', 'Story', 'task', '', 0, 'spec', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('pathfind', 'project', 'PathFind', 'task', '', 1, 'spec', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('incident', 'project', 'Incident', 'task', '', 2, 'spec', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_launchbinding
                (issue_type_id, state_id, prompt, required_skills, model_id, reasoning_id,
                 auto_start, subtree_run_enabled, created_at, updated_at)
            VALUES
                ('story', 'spec', 'Specify.', '["to-spec"]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('story', 'grill', 'Grill.', '[]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('story', 'tickets', 'Ticket.', '["to-tickets","tdd"]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                ('incident', 'spec', 'Incident.', '["to-spec"]', NULL, NULL, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        )
        .await
        .expect("seed pre-entry-skill rows");
    database
}

async fn entry_skills(database: &DatabaseConnection) -> Vec<(String, Option<String>)> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT issue_type_id || ':' || state_id AS binding, entry_skill
             FROM worktracker_launchbinding ORDER BY binding"
                .to_owned(),
        ))
        .await
        .expect("read migrated entry skills")
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "binding").expect("binding identity"),
                row.try_get("", "entry_skill").expect("entry skill"),
            )
        })
        .collect()
}

#[tokio::test]
async fn seeds_only_reviewed_bindings_that_already_require_the_skill_and_repeats_cleanly() {
    let database = fixture().await;

    install(&database).await.expect("adopt entry skills");
    let first = entry_skills(&database).await;
    install(&database).await.expect("repeat entry-skill migration");
    let second = entry_skills(&database).await;

    assert_eq!(second, first);
    assert_eq!(
        first,
        vec![
            ("incident:spec".into(), None),
            ("story:grill".into(), None),
            ("story:spec".into(), Some("to-spec".into())),
            ("story:tickets".into(), Some("to-tickets".into())),
        ]
    );
    assert!(has_entry_skill_column(&database).await.unwrap());
    let ledger = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT migration_id, source_commit FROM {LEDGER_TABLE} WHERE singleton = 1"
            ),
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ledger.try_get::<String>("", "migration_id").unwrap(), MIGRATION_ID);
    assert_eq!(ledger.try_get::<String>("", "source_commit").unwrap(), SOURCE_COMMIT);
}

#[tokio::test]
async fn preserves_an_existing_entry_skill_when_adopting_a_django_migrated_column() {
    let database = fixture().await;
    database
        .execute_unprepared(
            "ALTER TABLE worktracker_launchbinding ADD COLUMN entry_skill varchar(128) NULL;
             UPDATE worktracker_launchbinding SET entry_skill = 'tdd'
             WHERE issue_type_id = 'story' AND state_id = 'tickets';",
        )
        .await
        .expect("simulate a Django 0047 column with a preserved value");

    install(&database).await.expect("adopt existing entry-skill shape");

    assert!(entry_skills(&database)
        .await
        .contains(&("story:tickets".into(), Some("tdd".into()))));
}

#[tokio::test]
async fn a_failed_seed_rolls_back_the_column_and_ledger() {
    let database = fixture().await;
    database
        .execute_unprepared(
            "UPDATE worktracker_launchbinding SET required_skills = 'not-json'
             WHERE issue_type_id = 'story' AND state_id = 'spec'",
        )
        .await
        .expect("inject malformed legacy data");

    install(&database)
        .await
        .expect_err("malformed required skills must stop the migration");

    assert!(!has_entry_skill_column(&database).await.unwrap());
    let ledger_count = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
            [LEDGER_TABLE.into()],
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(ledger_count, 0);
}

#[test]
fn classification_recognizes_the_entry_skill_migration_ledger() {
    assert!(rust_ledger::owned_ledgers()
        .iter()
        .any(|(table, version)| *table == LEDGER_TABLE && *version == VERSION));
}
