use sea_orm::{ConnectionTrait, Database, DbBackend, Schema};
use seaography::async_graphql::Request;
use ticketry_entities::project;
use ticketry_work_management::CommandDatabase;

/// Onboarding falls back to the oldest project, so the authored read must
/// return creation order even when ids sort the other way (CODING-2915).
#[tokio::test]
async fn onboarding_projects_return_in_creation_order() {
    let database = Database::connect("sqlite::memory:").await.unwrap();
    database
        .execute_raw(
            DbBackend::Sqlite
                .build(&Schema::new(DbBackend::Sqlite).create_table_from_entity(project::Entity)),
        )
        .await
        .unwrap();
    database.execute_unprepared(
        "INSERT INTO worktracker_project
        (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
        ('20000000000000000000000000000001', 'Newer', 'newer', '', 1, 1, '2026-02-01 00:00:00', '2026-02-01 00:00:00', 1),
        ('20000000000000000000000000000002', 'Oldest', 'oldest', '', 1, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00', 1);",
    ).await.unwrap();
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

    let response = schema
        .execute(
            Request::new(include_str!(
                "../../../../../src/features/projects/operations/projects.graphql"
            ))
            .operation_name("WorkTrackerOnboarding"),
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let body = response.data.into_json().unwrap();
    let slugs: Vec<&str> = body["projects"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["slug"].as_str().unwrap())
        .collect();
    assert_eq!(slugs, ["oldest", "newer"]);
}
