use std::time::Duration;

use sea_orm::{
    ColumnTrait, ConnectionTrait, Database, DbBackend, EntityTrait, QueryFilter, Schema,
};
use seaography::async_graphql::{Request, Variables};
use serde_json::json;
use ticketry_entities::project;
use ticketry_work_management::{begin_write, open_for_commands, CommandDatabase};

const FIRST: &str = "20000000000000000000000000000001";
const OTHER: &str = "20000000000000000000000000000002";

#[tokio::test]
async fn onboarding_acknowledgement_waits_for_a_writer_and_only_updates_its_project() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("state.db");
    let setup = Database::connect(format!("sqlite:{}?mode=rwc", path.display()))
        .await
        .unwrap();
    setup
        .execute_raw(
            DbBackend::Sqlite
                .build(&Schema::new(DbBackend::Sqlite).create_table_from_entity(project::Entity)),
        )
        .await
        .unwrap();
    setup.execute_unprepared(
        "INSERT INTO worktracker_project
        (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
        ('20000000000000000000000000000001', 'First', 'first', '', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
        ('20000000000000000000000000000002', 'Other', 'other', '', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1);",
    ).await.unwrap();
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
    let blocker = begin_write(&other_writer).await.unwrap();
    blocker
        .execute_unprepared(
            "UPDATE worktracker_project SET description = 'Concurrent write' WHERE slug = 'other'",
        )
        .await
        .unwrap();
    let release = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        blocker.commit().await.unwrap();
    });
    let response = schema
        .execute(
            Request::new(include_str!(
                "../../../../../src/features/projects/operations/projects.graphql"
            ))
            .operation_name("AcknowledgeWorkTrackerOnboarding")
            .variables(Variables::from_json(
                json!({ "projectId": "20000000-0000-0000-0000-000000000001" }),
            )),
        )
        .await;
    release.await.unwrap();
    assert!(
        response.errors.is_empty(),
        "acknowledgement must wait for the writer: {:?}",
        response.errors
    );
    let body = response.data.into_json().unwrap();
    assert_eq!(body["acknowledge_onboarding"]["onboarding_required"], false);
    let first = project::Entity::find()
        .filter(project::Column::Id.eq(FIRST))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let other = project::Entity::find()
        .filter(project::Column::Id.eq(OTHER))
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert!(!first.onboarding_required);
    assert!(other.onboarding_required);
    assert_eq!(other.description, "Concurrent write");
}
