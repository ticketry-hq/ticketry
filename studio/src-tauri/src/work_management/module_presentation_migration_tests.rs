use sea_orm::{
    ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend,
    EntityTrait, ModelTrait, Set, Statement,
};

use super::*;
use crate::work_management::entities::{issue, module_presentation};

async fn fixture() -> DatabaseConnection {
    let mut options = ConnectOptions::new("sqlite::memory:");
    options.max_connections(1).min_connections(1);
    let database = Database::connect(options).await.expect("open fixture");
    database
        .execute_unprepared(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE worktracker_project (
                id varchar(32) NOT NULL PRIMARY KEY,
                name varchar(255) NOT NULL DEFAULT '',
                slug varchar(64) NOT NULL,
                description text NOT NULL DEFAULT '',
                seq_counter integer NOT NULL DEFAULT 0,
                state_revision bigint NOT NULL DEFAULT 0,
                manual_module_order bool NOT NULL DEFAULT 0,
                created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                onboarding_required bool NOT NULL DEFAULT 0
            );
            CREATE TABLE worktracker_issue (
                id varchar(32) NOT NULL PRIMARY KEY,
                project_id varchar(32) NOT NULL REFERENCES worktracker_project(id) ON DELETE CASCADE,
                type varchar(16) NOT NULL,
                issue_type_id varchar(32) NOT NULL DEFAULT '',
                parent_id varchar(32),
                module_id varchar(32),
                state_id varchar(32),
                state_revision bigint NOT NULL DEFAULT 0,
                name varchar(512) NOT NULL DEFAULT '',
                sequence_id integer NOT NULL,
                is_archived bool NOT NULL DEFAULT 0,
                rank varchar(64) NOT NULL DEFAULT '',
                description text NOT NULL DEFAULT '',
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )
        .await
        .expect("create fixture schema");
    database
}

async fn project(database: &DatabaseConnection, id: &str, manual: bool) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO worktracker_project (id, slug, manual_module_order) VALUES (?, ?, ?)",
            [id.into(), id.into(), manual.into()],
        ))
        .await
        .expect("insert project");
}

async fn module(
    database: &DatabaseConnection,
    id: &str,
    project_id: &str,
    sequence_id: i32,
    rank: &str,
    archived: bool,
) {
    database
        .execute_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO worktracker_issue \
             (id, project_id, type, sequence_id, rank, is_archived) \
             VALUES (?, ?, 'module', ?, ?, ?)",
            [
                id.into(),
                project_id.into(),
                sequence_id.into(),
                rank.into(),
                archived.into(),
            ],
        ))
        .await
        .expect("insert module");
}

async fn count(database: &DatabaseConnection, table: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT COUNT(*) AS count FROM {table}"),
        ))
        .await
        .expect("count query")
        .expect("count row")
        .try_get("", "count")
        .expect("decode count")
}

#[tokio::test]
async fn fresh_schema_creates_an_empty_presentation_table_and_drops_the_flag() {
    let database = fixture().await;

    install(&database).await.expect("migrate fresh schema");

    assert!(table_exists(&database, PRESENTATION_TABLE).await.unwrap());
    assert!(
        !column_exists(&database, PROJECT_TABLE, MANUAL_ORDER_COLUMN)
            .await
            .unwrap()
    );
    assert_eq!(count(&database, PRESENTATION_TABLE).await, 0);
}

#[tokio::test]
async fn automatic_projects_remain_rowless() {
    let database = fixture().await;
    project(&database, "automatic", false).await;
    module(&database, "automatic-module", "automatic", 1, "M", false).await;

    install(&database).await.expect("migrate automatic project");

    assert_eq!(count(&database, PRESENTATION_TABLE).await, 0);
}

#[tokio::test]
async fn manual_projects_copy_ranks_exactly() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "first", "manual", 1, "00A", false).await;
    module(&database, "last", "manual", 2, "zzZ", false).await;

    install(&database).await.expect("migrate manual project");

    let rows = module_presentation::Entity::find()
        .all(&database)
        .await
        .expect("read presentations");
    assert_eq!(
        rows.into_iter()
            .map(|row| (row.module_id, row.rank, row.tab_hidden))
            .collect::<Vec<_>>(),
        vec![
            ("first".to_owned(), "00A".to_owned(), false),
            ("last".to_owned(), "zzZ".to_owned(), false),
        ]
    );
}

#[tokio::test]
async fn partial_empty_ranks_are_preserved() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "unranked", "manual", 1, "", false).await;

    install(&database).await.expect("migrate partial order");

    assert_eq!(
        module_presentation::Entity::find_by_id("unranked")
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .rank,
        ""
    );
}

#[tokio::test]
async fn archived_modules_are_excluded() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "active", "manual", 1, "A", false).await;
    module(&database, "archived", "manual", 2, "B", true).await;

    install(&database).await.expect("migrate archived module");

    assert!(module_presentation::Entity::find_by_id("active")
        .one(&database)
        .await
        .unwrap()
        .is_some());
    assert!(module_presentation::Entity::find_by_id("archived")
        .one(&database)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn duplicate_ranks_remain_distinct_module_rows() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "one", "manual", 1, "same", false).await;
    module(&database, "two", "manual", 2, "same", false).await;

    install(&database).await.expect("migrate duplicate ranks");

    assert_eq!(count(&database, PRESENTATION_TABLE).await, 2);
}

#[tokio::test]
async fn repeat_install_is_a_no_op() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "module", "manual", 1, "rank", false).await;

    install(&database).await.expect("first install");
    install(&database).await.expect("repeat install");

    assert_eq!(count(&database, PRESENTATION_TABLE).await, 1);
    assert_eq!(count(&database, LEDGER_TABLE).await, 1);
}

#[tokio::test]
async fn failed_column_removal_rolls_back_the_old_shape() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "module", "manual", 1, "rank", false).await;
    database
        .execute_unprepared(
            "CREATE VIEW manual_order_view AS \
             SELECT manual_module_order FROM worktracker_project",
        )
        .await
        .expect("create failure trigger");

    assert!(install(&database).await.is_err());

    assert!(column_exists(&database, PROJECT_TABLE, MANUAL_ORDER_COLUMN)
        .await
        .unwrap());
    assert!(!table_exists(&database, PRESENTATION_TABLE).await.unwrap());
    assert!(!table_exists(&database, LEDGER_TABLE).await.unwrap());
}

#[tokio::test]
async fn migration_uses_only_the_supplied_database() {
    let supplied = fixture().await;
    let other = fixture().await;
    project(&supplied, "supplied", true).await;
    module(&supplied, "supplied-module", "supplied", 1, "A", false).await;
    project(&other, "other", true).await;
    module(&other, "other-module", "other", 1, "B", false).await;

    install(&supplied).await.expect("migrate supplied database");

    assert!(table_exists(&supplied, PRESENTATION_TABLE).await.unwrap());
    assert!(
        !column_exists(&supplied, PROJECT_TABLE, MANUAL_ORDER_COLUMN)
            .await
            .unwrap()
    );
    assert!(!table_exists(&other, PRESENTATION_TABLE).await.unwrap());
    assert!(column_exists(&other, PROJECT_TABLE, MANUAL_ORDER_COLUMN)
        .await
        .unwrap());
}

#[tokio::test]
async fn entity_relation_is_unique_and_cascades_with_the_module() {
    let database = fixture().await;
    project(&database, "manual", true).await;
    module(&database, "module", "manual", 1, "A", false).await;
    install(&database).await.expect("migrate entity fixture");

    let module = issue::Entity::find_by_id("module")
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        module
            .find_related(module_presentation::Entity)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .rank,
        "A"
    );
    let duplicate = module_presentation::ActiveModel {
        module_id: Set("module".to_owned()),
        rank: Set("B".to_owned()),
        tab_hidden: Set(false),
    }
    .insert(&database)
    .await;
    assert!(duplicate.is_err());

    issue::Entity::delete_by_id("module")
        .exec(&database)
        .await
        .expect("delete module");
    assert_eq!(count(&database, PRESENTATION_TABLE).await, 0);
}

#[tokio::test]
async fn generated_contract_has_reads_and_relations_but_no_public_writes_or_project_flag() {
    let sdl = crate::graphql_foundation::generated_schema_sdl()
        .await
        .expect("build generated schema");
    let presentation = sdl
        .split("type WorktrackerModulepresentation {")
        .nth(1)
        .and_then(|value| value.split('}').next())
        .expect("ModulePresentation output type");
    assert!(presentation.contains("moduleId: String!"));
    assert!(presentation.contains("rank: String!"));
    assert!(presentation.contains("tabHidden: Boolean!"));
    assert!(presentation.contains("module: WorktrackerIssue"));

    let project = sdl
        .split("type WorktrackerProject {")
        .nth(1)
        .and_then(|value| value.split('}').next())
        .expect("Project output type");
    assert!(!project.contains("manualModuleOrder"));
    assert!(!sdl.contains("worktrackerModulepresentationCreate"));
    assert!(!sdl.contains("worktrackerModulepresentationUpdate"));
    assert!(!sdl.contains("worktrackerModulepresentationDelete"));
}
