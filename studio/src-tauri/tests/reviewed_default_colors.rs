use muxed_studio_lib::graphql_foundation::initialize_with_worktracker_commands_and_install;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_entities::work_management::{
    issue_type, issue_type_transition, launch_binding, project, state,
};
use ticketry_installation::adoption::provisioning;
use ticketry_work_management::work_management::commands::catalog::{self, CreateProject};
use ticketry_work_management::work_management::open_for_commands;
use ticketry_work_management::work_management::project_onboarding_migration;

const EXPECTED_STATES: [(&str, &str, &str, i32, bool); 8] = [
    ("Ideas", "backlog", "#60646C", 0, true),
    ("Grill", "backlog", "#FA4D56", 1, true),
    ("Spec", "unstarted", "#8E4EC6", 2, true),
    ("Tickets", "unstarted", "#33B1FF", 3, true),
    ("Implement", "started", "#F59E0B", 4, true),
    ("Review", "started", "#08BDBA", 5, true),
    ("Done", "completed", "#46A758", 6, true),
    ("Cancelled", "cancelled", "#9AA4BC", 7, true),
];

async fn create_project(database: &sea_orm::DatabaseConnection, name: &str, slug: &str) -> String {
    catalog::create_project(
        database,
        CreateProject {
            name: name.to_owned(),
            slug: slug.to_owned(),
            description: Some(format!("{name} description")),
        },
    )
    .await
    .expect("create project from reviewed defaults")
}

async fn assert_persisted_catalog(database: &sea_orm::DatabaseConnection, project_id: &str) {
    let states = state::Entity::find()
        .filter(state::Column::ProjectId.eq(project_id))
        .order_by_asc(state::Column::SortOrder)
        .all(database)
        .await
        .expect("read persisted states");
    let observed = states
        .iter()
        .map(|row| {
            (
                row.name.as_str(),
                row.group.as_str(),
                row.color.as_str(),
                row.sort_order,
                row.is_protected,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(observed, EXPECTED_STATES);

    let type_ids = issue_type::Entity::find()
        .filter(issue_type::Column::ProjectId.eq(project_id))
        .all(database)
        .await
        .expect("read seeded issue types")
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
    assert_eq!(type_ids.len(), 4);
    assert_eq!(
        issue_type_transition::Entity::find()
            .filter(issue_type_transition::Column::IssueTypeId.is_in(type_ids.clone()))
            .count(database)
            .await
            .expect("count seeded transitions"),
        23
    );
    assert_eq!(
        launch_binding::Entity::find()
            .filter(launch_binding::Column::IssueTypeId.is_in(type_ids))
            .count(database)
            .await
            .expect("count seeded launch bindings"),
        15
    );
}

async fn assert_generated_state_read(api: &TransportApiImpl, project_id: &str) {
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
    .expect("parse GraphQL response");
    assert!(response.get("errors").is_none(), "{response}");
    let observed = response["data"]["states"]["nodes"]
        .as_array()
        .expect("state nodes")
        .iter()
        .map(|row| {
            (
                row["name"].as_str().expect("state name"),
                row["group"].as_str().expect("state group"),
                row["color"].as_str().expect("state color"),
                row["sort_order"].as_i64().expect("state sort order") as i32,
                row["is_protected"].as_bool().expect("state protection"),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(observed, EXPECTED_STATES);
}

#[tokio::test]
async fn fresh_install_projects_persist_and_read_the_reviewed_state_colors() {
    let directory = tempfile::tempdir().expect("create fresh installation directory");
    provisioning::provision(directory.path())
        .await
        .expect("provision fresh installation");
    let state_path = directory.path().join("state.db");
    let database = open_for_commands(&state_path)
        .await
        .expect("open provisioned database");
    // Provisioning writes the Workspace-owned shape the adoption validator
    // still recognizes; startup moves onboarding onto the project before any
    // authored command runs, so these tests take the same order.
    project_onboarding_migration::install(&database)
        .await
        .expect("move onboarding onto the project");

    let first = create_project(&database, "First", "FST").await;
    let second = create_project(&database, "Second", "SND").await;
    assert_persisted_catalog(&database, &first).await;
    assert_persisted_catalog(&database, &second).await;

    let api = TransportApiImpl::new();
    let _runtime = initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state_path,
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("compose production GraphQL model reads");
    assert_generated_state_read(&api, &first).await;
    assert_generated_state_read(&api, &second).await;
}

#[tokio::test]
async fn a_catalog_insert_failure_rolls_back_the_whole_project() {
    let directory = tempfile::tempdir().expect("create fresh installation directory");
    provisioning::provision(directory.path())
        .await
        .expect("provision fresh installation");
    let database = open_for_commands(&directory.path().join("state.db"))
        .await
        .expect("open provisioned database");
    project_onboarding_migration::install(&database)
        .await
        .expect("move onboarding onto the project");
    let before = (
        project::Entity::find().count(&database).await.unwrap(),
        state::Entity::find().count(&database).await.unwrap(),
        issue_type::Entity::find().count(&database).await.unwrap(),
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
    );
    database
        .execute_unprepared(
            "CREATE TRIGGER fail_review_seed BEFORE INSERT ON worktracker_state \
             WHEN NEW.name = 'Review' BEGIN SELECT RAISE(ABORT, 'injected seed failure'); END",
        )
        .await
        .expect("install deterministic failure");

    let error = catalog::create_project(
        &database,
        CreateProject {
            name: "Incomplete".to_owned(),
            slug: "BAD".to_owned(),
            description: None,
        },
    )
    .await
    .expect_err("Review insert must fail");
    assert_eq!(error.code(), "worktracker_storage_failed");
    let after = (
        project::Entity::find().count(&database).await.unwrap(),
        state::Entity::find().count(&database).await.unwrap(),
        issue_type::Entity::find().count(&database).await.unwrap(),
        issue_type_transition::Entity::find()
            .count(&database)
            .await
            .unwrap(),
        launch_binding::Entity::find()
            .count(&database)
            .await
            .unwrap(),
    );
    assert_eq!(after, before);
}
