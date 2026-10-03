use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
use serde_json::{json, Value};
use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::{adopt_worktracker_and_install, InstallationOwnership};
use ticketry_planner::{PlannerEndpoint, PlannerService};

async fn native(api: &TransportApiImpl, query: &str, variables: Value) -> Value {
    let response: Value = serde_json::from_str(
        &api.clone()
            .graphql_execute(json!({"query": query, "variables": variables}).to_string())
            .await,
    )
    .unwrap();
    data(response)
}

async fn planner(endpoint: &PlannerEndpoint, query: &str, variables: Value) -> Value {
    let response = reqwest::Client::new()
        .post(&endpoint.graphql_url)
        .bearer_auth(&endpoint.bearer_token)
        .json(&json!({"query": query, "variables": variables}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    data(response)
}

fn data(response: Value) -> Value {
    assert!(
        response.get("errors").is_none(),
        "GraphQL failed: {response}"
    );
    response["data"].clone()
}

const READ: &str = r#"query($project: String!) {
    worktrackerProject(filters: {id: {eq: $project}}) { nodes { id name } }
    worktrackerSprint(filters: {projectId: {eq: $project}}) { nodes { id name status goals { nodes { id position text } } } }
    worktrackerIssue(filters: {projectId: {eq: $project}}) { nodes { id name sprintId stateRevision } }
}"#;

#[tokio::test]
async fn desktop_composition_and_planner_share_live_planning_data_across_restart() {
    let isolated = tempfile::tempdir().unwrap();
    let directory = isolated.path().join("configured-ticketry-profile");
    std::fs::create_dir(&directory).unwrap();
    let ownership = ticketry_data_directory::DataDirectoryGuard::acquire(&directory).unwrap();
    let api = TransportApiImpl::new();
    let adopted = adopt_worktracker_and_install(
        &directory.join("rust-core.sqlite3"),
        &directory,
        &api,
        InstallationOwnership::Owned,
    )
    .await
    .unwrap();
    ticketry_settings::publish_readiness(
        &directory,
        &ticketry_settings::Slice2Readiness::complete(),
    )
    .unwrap();
    let runtime = PlannerService::start(api.clone(), 0, |error| panic!("{error}"))
        .await
        .unwrap();
    let endpoint = runtime.endpoint().clone();
    let project = native(
        &api,
        r#"mutation { create_project(name: "Live planning", slug: "LIV") { id name } }"#,
        json!({}),
    )
    .await["create_project"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let variables = json!({"project": project});
    assert_eq!(
        planner(&endpoint, READ, variables.clone()).await["worktrackerProject"]["nodes"][0]["name"],
        "Live planning"
    );
    let sprint = planner(&endpoint, r#"mutation($project: String!) { worktrackerSprintCreateOne(data: {projectId: $project, name: "Sprint one"}) { id } }"#, variables.clone()).await["worktrackerSprintCreateOne"]["id"].as_str().unwrap().to_owned();
    let goal = native(&api, r#"mutation($sprint: String!) { create_sprint_goal(sprint_id: $sprint, text: "Share the live database") { id text } }"#, json!({"sprint": sprint})).await["create_sprint_goal"]["id"].as_str().unwrap().to_owned();
    let types = native(&api, r#"query($project: String!) { worktrackerIssuetype(filters: {projectId: {eq: $project}, name: {eq: "Story"}}) { nodes { id } } }"#, variables.clone()).await;
    let story_type = types["worktrackerIssuetype"]["nodes"][0]["id"]
        .as_str()
        .unwrap();
    let story = native(&api, r#"mutation($project: String!, $type: String!) { create_work_item(project_id: $project, issue_type_id: $type, name: "Created in Ticketry") { id } }"#, json!({"project": project, "type": story_type})).await["create_work_item"]["id"].as_str().unwrap().to_owned();
    let planned = planner(&endpoint, r#"mutation($story: String!, $sprint: String!) { update_work_item(id: $story, sprint_id: $sprint) { id sprintId stateRevision } }"#, json!({"story": story, "sprint": sprint})).await;
    assert_eq!(planned["update_work_item"]["sprintId"], sprint);
    planner(&endpoint, r#"mutation($goal: String!) { update_sprint_goal(id: $goal, text: "Updated in the planner") { id text } }"#, json!({"goal": goal})).await;
    planner(&endpoint, r#"mutation($story: String!) { update_work_item(id: $story, name: "Updated in the planner") { id name } }"#, json!({"story": story})).await;
    let expected = native(&api, READ, variables.clone()).await;
    assert_eq!(
        expected["worktrackerSprint"]["nodes"][0]["goals"]["nodes"][0]["text"],
        "Updated in the planner"
    );
    assert_eq!(
        expected["worktrackerIssue"]["nodes"][0]["name"],
        "Updated in the planner"
    );
    assert_eq!(expected["worktrackerIssue"]["nodes"][0]["sprintId"], sprint);
    assert_eq!(planner(&endpoint, READ, variables.clone()).await, expected);

    runtime.shutdown().await.unwrap();
    drop(api);
    drop(adopted);
    drop(ownership);
    let _ownership = ticketry_data_directory::DataDirectoryGuard::acquire(&directory).unwrap();
    let api = TransportApiImpl::new();
    let restarted = adopt_worktracker_and_install(
        &directory.join("rust-core.sqlite3"),
        &directory,
        &api,
        InstallationOwnership::Owned,
    )
    .await
    .unwrap();
    ticketry_settings::publish_readiness(
        &directory,
        &ticketry_settings::Slice2Readiness::complete(),
    )
    .unwrap();
    let runtime = PlannerService::start(api.clone(), 0, |error| panic!("{error}"))
        .await
        .unwrap();
    assert_ne!(runtime.endpoint().bearer_token, endpoint.bearer_token);
    assert_eq!(native(&api, READ, variables.clone()).await, expected);
    assert_eq!(planner(runtime.endpoint(), READ, variables).await, expected);
    let denied = reqwest::Client::new()
        .post(&runtime.endpoint().graphql_url)
        .bearer_auth(&endpoint.bearer_token)
        .json(&json!({"query": "{ __typename }"}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), reqwest::StatusCode::FORBIDDEN);

    // Invalid public writes still use Ticketry's guard, including completed goals.
    native(&api, r#"mutation($sprint: String!) { update_sprint(id: $sprint, status: "active") { id status } }"#, json!({"sprint": sprint})).await;
    native(&api, r#"mutation($sprint: String!) { update_sprint(id: $sprint, status: "completed") { id status } }"#, json!({"sprint": sprint})).await;
    let rejected: Value = reqwest::Client::new().post(&runtime.endpoint().graphql_url).bearer_auth(&runtime.endpoint().bearer_token)
        .json(&json!({"query": "mutation($goal: String!) { update_sprint_goal(id: $goal, text: \"Must fail\") { id } }", "variables": {"goal": goal}}))
        .send().await.unwrap().json().await.unwrap();
    assert!(
        rejected["errors"]
            .as_array()
            .is_some_and(|errors| !errors.is_empty()),
        "{rejected}"
    );
    assert!(directory.join("state.db").is_file());
    for snapshot in [
        "planner.sqlite3",
        "planner.previous.sqlite3",
        "planner.sqlite3.lock",
    ] {
        assert!(
            !directory.join(snapshot).exists(),
            "unexpected planner snapshot: {snapshot}"
        );
    }
    let provenance = ticketry_entities::app_settings::Entity::find()
        .filter(ticketry_entities::app_settings::Column::Scope.eq("roadmap.local_provenance"))
        .count(restarted.runtime.commands())
        .await
        .unwrap();
    assert_eq!(provenance, 0);
    runtime.shutdown().await.unwrap();
    drop(restarted);
}
