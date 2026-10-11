//! Project aggregate deletion against the installed production schema.
//!
//! The recorded Django schema keeps its catalogue foreign keys, so these
//! cases prove `delete_project` tears down the whole aggregate under enforced
//! constraints and rolls back atomically when any step fails.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use seaography::async_graphql::{dynamic::Schema, Request, Variables};
use serde_json::{json, Value};
use ticketry_installation::install_final_schema_migrations;
use ticketry_work_management::{open_for_commands, CommandDatabase};

#[path = "final_schema_migration_chain/support.rs"]
#[allow(dead_code)]
mod support;

const PROJECTS: &str = include_str!("../../src/features/projects/operations/projects.graphql");
const CREATE_WORK_ITEM: &str = "mutation CreateWorkTrackerWorkItem(
    $projectId: String!, $name: String!, $issueTypeId: String!
) {
    create_work_item(project_id: $projectId, name: $name, issue_type_id: $issueTypeId) { id }
}";
/// The fixture's preserved project, which must survive another project's delete.
const SURVIVOR: &str = "00000000000000000000000000001001";

struct Installed {
    _directory: tempfile::TempDir,
    database: DatabaseConnection,
    schema: Schema,
}

async fn installed() -> Installed {
    let (directory, setup) = support::fixture().await;
    install_final_schema_migrations(&setup)
        .await
        .expect("install the final schema");
    setup.close().await.unwrap();
    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .expect("open the installed database for commands");
    let schema = ticketry_graphql_schema::foundation_schema(
        database.clone(),
        Some(database.clone()),
        Some(CommandDatabase(database.clone())),
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    Installed {
        _directory: directory,
        database,
        schema,
    }
}

async fn execute(
    installed: &Installed,
    document: &str,
    operation: &str,
    variables: Value,
) -> seaography::async_graphql::Response {
    installed
        .schema
        .execute(
            Request::new(document)
                .operation_name(operation)
                .variables(Variables::from_json(variables)),
        )
        .await
}

async fn data(installed: &Installed, document: &str, operation: &str, variables: Value) -> Value {
    let response = execute(installed, document, operation, variables).await;
    assert!(
        response.errors.is_empty(),
        "{operation}: {:?}",
        response.errors
    );
    response.data.into_json().unwrap()
}

/// Create a project with its provisioned catalogue and one module in it.
async fn project_with_module(installed: &Installed) -> String {
    let project = data(
        installed,
        PROJECTS,
        "CreateWorkTrackerProject",
        json!({"name": "E2E Cascade", "slug": "ELD", "description": ""}),
    )
    .await["create_project"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let module_type = scalar(
        installed,
        &format!(
            "SELECT id AS value FROM worktracker_issuetype
             WHERE project_id = '{}' AND level = 'module'",
            project.replace('-', "")
        ),
    )
    .await;
    data(
        installed,
        CREATE_WORK_ITEM,
        "CreateWorkTrackerWorkItem",
        json!({"projectId": project, "name": "Cascade Module", "issueTypeId": module_type}),
    )
    .await;
    project
}

async fn scalar(installed: &Installed, sql: &str) -> String {
    installed
        .database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .unwrap()
        .expect("one row")
        .try_get::<String>("", "value")
        .unwrap()
}

/// Every row in the installed schema that belongs to a project, by table.
async fn aggregate_rows(installed: &Installed, project: &str) -> Vec<(String, i64)> {
    let project = project.replace('-', "");
    let mut counts = Vec::new();
    for (table, filter) in [
        ("worktracker_project", "id = ?1"),
        ("worktracker_state", "project_id = ?1"),
        ("worktracker_issuetype", "project_id = ?1"),
        ("worktracker_issue", "project_id = ?1"),
        (
            "worktracker_issuetypetransition",
            "issue_type_id IN (SELECT id FROM worktracker_issuetype WHERE project_id = ?1)",
        ),
        (
            "worktracker_launchbinding",
            "issue_type_id IN (SELECT id FROM worktracker_issuetype WHERE project_id = ?1)",
        ),
        (
            "worktracker_modulepresentation",
            "module_id IN (SELECT id FROM worktracker_issue WHERE project_id = ?1)",
        ),
    ] {
        let row = installed
            .database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                format!("SELECT COUNT(*) AS count FROM {table} WHERE {filter}"),
                [project.clone().into()],
            ))
            .await
            .unwrap()
            .unwrap();
        counts.push((table.to_owned(), row.try_get::<i64>("", "count").unwrap()));
    }
    counts
}

fn nonzero(counts: &[(String, i64)]) -> Vec<&str> {
    counts
        .iter()
        .filter(|(_, count)| *count > 0)
        .map(|(table, _)| table.as_str())
        .collect()
}

#[tokio::test]
async fn deleting_a_provisioned_project_removes_its_whole_aggregate_only() {
    let installed = installed().await;
    let survivor_before = aggregate_rows(&installed, SURVIVOR).await;
    let project = project_with_module(&installed).await;
    let before = aggregate_rows(&installed, &project).await;
    for table in [
        "worktracker_state",
        "worktracker_issuetype",
        "worktracker_issue",
        "worktracker_issuetypetransition",
        "worktracker_launchbinding",
    ] {
        assert!(
            before
                .iter()
                .any(|(name, count)| name == table && *count > 0),
            "fixture must populate {table}: {before:?}"
        );
    }

    let deleted = data(
        &installed,
        PROJECTS,
        "DeleteWorkTrackerProject",
        json!({"id": project}),
    )
    .await;

    assert_eq!(deleted["delete_project"], true);
    assert_eq!(
        nonzero(&aggregate_rows(&installed, &project).await),
        Vec::<&str>::new()
    );
    assert_eq!(aggregate_rows(&installed, SURVIVOR).await, survivor_before);
}

#[tokio::test]
async fn a_failed_project_delete_rolls_back_every_aggregate_row() {
    let installed = installed().await;
    let project = project_with_module(&installed).await;
    let before = aggregate_rows(&installed, &project).await;
    // The project row is removed last; refusing it proves earlier teardown
    // steps are undone with it.
    installed
        .database
        .execute_unprepared(
            "CREATE TRIGGER refuse_project_delete BEFORE DELETE ON worktracker_project
             BEGIN SELECT RAISE(ABORT, 'refused by test'); END;",
        )
        .await
        .unwrap();

    let refused = execute(
        &installed,
        PROJECTS,
        "DeleteWorkTrackerProject",
        json!({"id": project}),
    )
    .await;

    assert_eq!(refused.errors.len(), 1, "{:?}", refused.errors);
    assert_eq!(aggregate_rows(&installed, &project).await, before);

    installed
        .database
        .execute_unprepared("DROP TRIGGER refuse_project_delete")
        .await
        .unwrap();
    let retried = data(
        &installed,
        PROJECTS,
        "DeleteWorkTrackerProject",
        json!({"id": project}),
    )
    .await;
    assert_eq!(retried["delete_project"], true);
    assert_eq!(
        nonzero(&aggregate_rows(&installed, &project).await),
        Vec::<&str>::new()
    );
}

#[tokio::test]
async fn deleting_a_migrated_project_with_nested_work_and_blockers_empties_it() {
    let installed = installed().await;
    installed
        .database
        .execute_unprepared(
            "INSERT INTO worktracker_issue_blocked_by (from_issue_id, to_issue_id) VALUES
             ('00000000000000000000000000001006', '00000000000000000000000000001004')",
        )
        .await
        .unwrap();
    let before = aggregate_rows(&installed, SURVIVOR).await;
    assert!(
        before
            .iter()
            .any(|(table, count)| table == "worktracker_modulepresentation" && *count > 0),
        "{before:?}"
    );

    let deleted = data(
        &installed,
        PROJECTS,
        "DeleteWorkTrackerProject",
        json!({"id": SURVIVOR}),
    )
    .await;

    assert_eq!(deleted["delete_project"], true);
    assert_eq!(
        nonzero(&aggregate_rows(&installed, SURVIVOR).await),
        Vec::<&str>::new()
    );
    assert_eq!(
        scalar(
            &installed,
            "SELECT CAST(COUNT(*) AS TEXT) AS value FROM worktracker_issue_blocked_by"
        )
        .await,
        "0"
    );
}
