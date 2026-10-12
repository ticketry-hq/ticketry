//! CODING-2911: a single-user model update must commit, not fail with SQLite
//! "database is locked" (5 or 517), while other connections hold read
//! snapshots and another writer commits underneath them.

use std::time::Duration;

use sea_orm::{
    ConnectionTrait, Database, DatabaseConnection, DbBackend, EntityTrait, Schema, Statement,
    TransactionTrait,
};
use seaography::async_graphql::{dynamic::Schema as GraphqlSchema, Request, Variables};
use serde_json::json;
use ticketry_entities::{
    agent_model, issue, issue_blocker, issue_type, issue_type_transition, launch_binding,
    module_presentation, project, reasoning_level, sprint, state,
};
use ticketry_work_management::{begin_write, open_for_commands, CommandDatabase};

const MODULE: &str = "50000000-0000-0000-0000-000000000002";
const MODULE_ROW: &str = "50000000000000000000000000000002";

struct Fixture {
    _directory: tempfile::TempDir,
    database: DatabaseConnection,
    other_writer: DatabaseConnection,
    schema: GraphqlSchema,
}

async fn fixture() -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let setup = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    setup
        .execute_unprepared("PRAGMA journal_mode=WAL")
        .await
        .unwrap();
    let ddl = Schema::new(DbBackend::Sqlite);
    for table in [
        ddl.create_table_from_entity(project::Entity),
        ddl.create_table_from_entity(state::Entity),
        ddl.create_table_from_entity(issue_type::Entity),
        ddl.create_table_from_entity(sprint::Entity),
        ddl.create_table_from_entity(issue::Entity),
        ddl.create_table_from_entity(module_presentation::Entity),
        ddl.create_table_from_entity(issue_blocker::Entity),
        ddl.create_table_from_entity(issue_type_transition::Entity),
        ddl.create_table_from_entity(agent_model::Entity),
        ddl.create_table_from_entity(reasoning_level::Entity),
        ddl.create_table_from_entity(launch_binding::Entity),
    ] {
        setup
            .execute_raw(DbBackend::Sqlite.build(&table))
            .await
            .unwrap();
    }
    setup
        .execute_unprepared(
            "INSERT INTO worktracker_project
            (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
            ('20000000000000000000000000000001', 'Project', 'project', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0),
            ('20000000000000000000000000000002', 'Retired', 'retired', '', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_state (id, project_id, name, \"group\", color, sort_order, is_protected, created_at, updated_at) VALUES
            ('80000000000000000000000000000001', '20000000000000000000000000000001', 'Ideas', 'backlog', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issuetype (id, project_id, name, level, color, sort_order, start_state_id, workflow_revision, is_pathfind, created_at, updated_at) VALUES
            ('70000000000000000000000000000001', '20000000000000000000000000000001', 'Story', 'task', '', 1, '80000000000000000000000000000001', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue (id, project_id, type, issue_type_id, state_id, state_revision, name, sequence_id, is_archived, rank, description, workspace_tab_order, created_at, updated_at) VALUES
            ('50000000000000000000000000000001', '20000000000000000000000000000001', 'task', '70000000000000000000000000000001', '80000000000000000000000000000001', 1, 'Existing', 1, 0, 'A', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('50000000000000000000000000000002', '20000000000000000000000000000001', 'module', '70000000000000000000000000000001', NULL, 1, 'Module', 2, 0, '', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_modulepresentation (module_id, rank, tab_hidden) VALUES
            ('50000000000000000000000000000002', 'V', 1);",
        )
        .await
        .unwrap();
    setup.close().await.unwrap();

    let database = open_for_commands(&path).await.unwrap();
    let other_writer = open_for_commands(&path).await.unwrap();
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
    Fixture {
        _directory: directory,
        database,
        other_writer,
        schema,
    }
}

/// Hold read snapshots open on other connections and start another writer
/// that commits `statement` while `request` runs. Returns the response once
/// every overlapping transaction has finished.
async fn execute_under_contention(
    fixture: &Fixture,
    statement: &str,
    request: Request,
) -> seaography::async_graphql::Response {
    let mut readers = Vec::new();
    for _ in 0..2 {
        let reader = fixture.database.begin().await.unwrap();
        reader
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT count(*) FROM worktracker_issue".to_owned(),
            ))
            .await
            .unwrap();
        readers.push(reader);
    }
    let blocker = begin_write(&fixture.other_writer).await.unwrap();
    blocker.execute_unprepared(statement).await.unwrap();
    let release = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        blocker.commit().await.unwrap();
    });

    let response = fixture.schema.execute(request).await;

    release.await.unwrap();
    for reader in readers {
        reader.rollback().await.unwrap();
    }
    response
}

#[tokio::test]
async fn module_presentation_update_commits_while_reads_overlap_a_concurrent_writer() {
    let fixture = fixture().await;

    let response = execute_under_contention(
        &fixture,
        "UPDATE worktracker_issue SET description = 'Concurrent write'
            WHERE id = '50000000000000000000000000000001'",
        Request::new(include_str!(
            "../../../../../src/features/projects/operations/projects.graphql"
        ))
        .operation_name("UpdateWorkTrackerModulePresentation")
        .variables(Variables::from_json(
            json!({ "moduleId": MODULE, "tabHidden": false }),
        )),
    )
    .await;

    assert!(
        response.errors.is_empty(),
        "the update must wait for the writer: {:?}",
        response.errors
    );
    let body = response.data.into_json().unwrap();
    assert_eq!(body["update_module_presentation"]["tab_hidden"], false);
    let presentation = module_presentation::Entity::find_by_id(MODULE_ROW)
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert!(!presentation.tab_hidden);
    let concurrent = issue::Entity::find_by_id("50000000000000000000000000000001")
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(concurrent.description, "Concurrent write");
}

#[tokio::test]
async fn work_item_update_commits_while_reads_overlap_a_concurrent_writer() {
    let fixture = fixture().await;

    let response = execute_under_contention(
        &fixture,
        "UPDATE worktracker_issue SET description = 'Concurrent write'
            WHERE id = '50000000000000000000000000000002'",
        Request::new(
            r#"mutation { update_work_item(
                id: "50000000-0000-0000-0000-000000000001",
                name: "Renamed while contended"
            ) { id name } }"#,
        ),
    )
    .await;

    assert!(
        response.errors.is_empty(),
        "the update must wait for the writer: {:?}",
        response.errors
    );
    let renamed = issue::Entity::find_by_id("50000000000000000000000000000001")
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(renamed.name, "Renamed while contended");
    let concurrent = issue::Entity::find_by_id(MODULE_ROW)
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(concurrent.description, "Concurrent write");
}

#[tokio::test]
async fn project_delete_commits_while_reads_overlap_a_concurrent_writer() {
    let fixture = fixture().await;

    let response = execute_under_contention(
        &fixture,
        "UPDATE worktracker_issue SET description = 'Concurrent write'
            WHERE id = '50000000000000000000000000000001'",
        Request::new(include_str!(
            "../../../../../src/features/projects/operations/projects.graphql"
        ))
        .operation_name("DeleteWorkTrackerProject")
        .variables(Variables::from_json(
            json!({ "id": "20000000-0000-0000-0000-000000000002" }),
        )),
    )
    .await;

    assert!(
        response.errors.is_empty(),
        "the delete must wait for the writer: {:?}",
        response.errors
    );
    assert!(
        project::Entity::find_by_id("20000000000000000000000000000002")
            .one(&fixture.database)
            .await
            .unwrap()
            .is_none()
    );
    let concurrent = issue::Entity::find_by_id("50000000000000000000000000000001")
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(concurrent.description, "Concurrent write");
}
