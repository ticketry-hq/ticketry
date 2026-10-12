use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_edition::{has, EditionCapability};
use ticketry_entities::{issue_type, issue_type_transition, launch_binding, project, state};
use ticketry_graphql_schema::initialize_with_worktracker_commands_and_install;
use ticketry_installation as provisioning;
use ticketry_work_management::create_project as create_project_command;
use ticketry_work_management::install_project_onboarding_schema;
use ticketry_work_management::open_for_commands;

use ticketry_work_management::CreateProject;

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
    create_project_command(
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
            .filter(launch_binding::Column::IssueTypeId.is_in(type_ids.clone()))
            .count(database)
            .await
            .expect("count seeded launch bindings"),
        15
    );
    let state_names = states
        .iter()
        .map(|state| (state.id.as_str(), state.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    for binding in launch_binding::Entity::find()
        .filter(launch_binding::Column::IssueTypeId.is_in(type_ids))
        .all(database)
        .await
        .expect("read seeded launch bindings")
    {
        let expected = match state_names[binding.state_id.as_str()] {
            "Grill" => Some("grill-with-docs"),
            "Spec" => Some("to-spec"),
            "Tickets" => Some("to-tickets"),
            _ => None,
        };
        assert_eq!(
            binding.stage_skills,
            serde_json::json!(expected.into_iter().collect::<Vec<_>>())
        );
    }
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
    if !has(EditionCapability::ReviewedWorkflowDefaults) {
        return; // Core seeds an empty slate; see the core counterpart below.
    }
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
    install_project_onboarding_schema(&database)
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
    install_project_onboarding_schema(&database)
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
            // Every edition seeds the Module type, after any reviewed states.
            "CREATE TRIGGER fail_module_seed BEFORE INSERT ON worktracker_issuetype \
             WHEN NEW.name = 'Module' BEGIN SELECT RAISE(ABORT, 'injected seed failure'); END",
        )
        .await
        .expect("install deterministic failure");

    let error = create_project_command(
        &database,
        CreateProject {
            name: "Incomplete".to_owned(),
            slug: "BAD".to_owned(),
            description: None,
        },
    )
    .await
    .expect_err("Module insert must fail");
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

async fn graphql(api: &TransportApiImpl, request: serde_json::Value) -> serde_json::Value {
    let response: serde_json::Value =
        serde_json::from_str(&api.clone().graphql_execute(request.to_string()).await)
            .expect("parse GraphQL response");
    assert!(response.get("errors").is_none(), "{response}");
    response["data"].clone()
}

/// CODING-2860: in core, both first-run provisioning and `create_project`
/// give an empty workflow slate — only the structural `Module` type — read
/// back through the public GraphQL model reads.
#[tokio::test]
async fn core_fresh_install_and_created_projects_hold_only_the_module_type() {
    if has(EditionCapability::ReviewedWorkflowDefaults) {
        return; // Pocock seeds the reviewed catalog; see the tests above.
    }
    let directory = tempfile::tempdir().expect("create fresh installation directory");
    provisioning::provision(directory.path())
        .await
        .expect("provision fresh installation");
    let state_path = directory.path().join("state.db");
    let database = open_for_commands(&state_path)
        .await
        .expect("open provisioned database");
    install_project_onboarding_schema(&database)
        .await
        .expect("move onboarding onto the project");

    let api = TransportApiImpl::new();
    let _runtime = initialize_with_worktracker_commands_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state_path,
        &directory.path().join("media"),
        &api,
    )
    .await
    .expect("compose production GraphQL model reads");
    let created = graphql(
        &api,
        serde_json::json!({
            "query": r#"mutation { create_project(name: "Core", slug: "COR") { id } }"#,
        }),
    )
    .await;
    let projects = graphql(
        &api,
        serde_json::json!({ "query": "{ worktrackerProject { nodes { id slug } } }" }),
    )
    .await;
    let project_ids = projects["worktrackerProject"]["nodes"]
        .as_array()
        .expect("project nodes")
        .iter()
        .map(|node| node["id"].as_str().expect("project id").to_owned())
        .collect::<Vec<_>>();
    assert_eq!(project_ids.len(), 2, "installation project and created project");
    assert!(project_ids.contains(&created["create_project"]["id"].as_str().unwrap().to_owned()));

    for project_id in project_ids {
        let catalog = graphql(
            &api,
            serde_json::json!({
                "query": include_str!("common/project_workflow_catalog.graphql"),
                "variables": { "projectId": project_id },
            }),
        )
        .await;
        assert_eq!(catalog["states"]["nodes"], serde_json::json!([]), "{project_id}");
        assert_eq!(
            catalog["issue_types"]["nodes"],
            serde_json::json!([{
                "name": "Module",
                "level": "module",
                "startStateId": null,
                "issueTypeTransition": { "nodes": [] },
                "launchBinding": { "nodes": [] },
            }]),
            "{project_id}"
        );
    }

    // Module creation needs no workflow: the Module type has no start state.
    let created_id = created["create_project"]["id"].as_str().unwrap();
    let module_type = graphql(
        &api,
        serde_json::json!({
            "query": r#"query($projectId: String!) {
                worktrackerIssuetype(filters: { projectId: { eq: $projectId } }) { nodes { id } }
            }"#,
            "variables": { "projectId": created_id },
        }),
    )
    .await["worktrackerIssuetype"]["nodes"][0]["id"]
        .clone();
    let module = graphql(
        &api,
        serde_json::json!({
            "query": r#"mutation($projectId: String!, $typeId: String!) {
                create_work_item(project_id: $projectId, name: "First module", issue_type_id: $typeId) {
                    name stateId
                }
            }"#,
            "variables": { "projectId": created_id, "typeId": module_type },
        }),
    )
    .await;
    assert_eq!(
        module["create_work_item"],
        serde_json::json!({ "name": "First module", "stateId": null })
    );
}
