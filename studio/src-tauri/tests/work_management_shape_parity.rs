use std::path::{Path, PathBuf};
use std::process::Command;

use tauri_graphql::{TransportApi, TransportApiImpl};
use ticketry_graphql_schema::initialize_with_worktracker_and_install;

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root")
}

fn django_fixture(database_path: &Path) -> serde_json::Value {
    let root = repository_root();
    let output = Command::new(root.join("backend/.venv/bin/python"))
        .arg(root.join("backend/worktracker/tests/build_shape_parity_fixture.py"))
        .arg(database_path)
        .current_dir(&root)
        .output()
        .expect("run Django parity fixture builder");
    assert!(
        output.status.success(),
        "Django parity fixture builder failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("decode Django REST parity oracle")
}

fn request(query: &str, variables: &serde_json::Value) -> String {
    serde_json::json!({ "query": query, "variables": variables }).to_string()
}

#[tokio::test]
async fn graphql_reads_match_django_rest_shapes_filters_and_ordering() {
    let directory = tempfile::tempdir().expect("create parity fixture directory");
    let state_database = directory.path().join("state.db");
    let fixture = django_fixture(&state_database);
    let api = TransportApiImpl::new();
    initialize_with_worktracker_and_install(
        &directory.path().join("rust-core.sqlite3"),
        &state_database,
        &api,
    )
    .await
    .expect("install GraphQL endpoint over the Django fixture");

    let query = r#"
        query ShapeParity(
          $project: String!
          $module: String!
          $state: String!
          $type: String!
          $workItemKey: String!
          $workItemIds: [String!]!
        ) {
          workspace { id slug name onboarding_required }
          projects { id name slug description manual_module_order }
          modules(project_id: $project) {
            id name project_id sequence_id key is_archived issue_type
          }
          archived_modules: modules(project_id: $project, include_archived: true) {
            id name project_id sequence_id key is_archived issue_type
          }
          work_items(module_id: $module) {
            id name project_id sequence_id state state_revision description parent_id
            sub_issues_count key is_archived created_at updated_at rank issue_type
            blocked_by_ids blocks_ids
          }
          state_work_items: work_items(state_id: $state) {
            id name project_id sequence_id state state_revision description parent_id
            sub_issues_count key is_archived created_at updated_at rank issue_type
            blocked_by_ids blocks_ids
          }
          work_items_by_ids(ids: $workItemIds) {
            id name project_id sequence_id state state_revision description parent_id
            sub_issues_count key is_archived created_at updated_at rank issue_type
            blocked_by_ids blocks_ids
          }
          work_item(id: $workItemKey) {
            id name project_id sequence_id state state_revision description parent_id
            sub_issues_count key is_archived created_at updated_at rank issue_type
            blocked_by_ids blocks_ids
          }
          states(project_id: $project) {
            id project name group color sort_order is_protected created_at updated_at
          }
          issue_types(project_id: $project) {
            id project name level color sort_order start_state workflow_revision is_pathfind
            created_at updated_at
          }
          issue_type(id: $type) {
            id project name level color sort_order start_state workflow_revision is_pathfind
            created_at updated_at
          }
          issue_type_transitions(issue_type_id: $type) {
            id issue_type from_state to_state agent_allowed
          }
          launch_bindings(project_id: $project) {
            id issue_type state prompt required_skills model reasoning auto_start
            subtree_run_enabled created_at updated_at
          }
          providers { id slug activated supports_unattended }
          agent_models { id provider name permitted_reasoning_levels }
          reasoning_levels { id name }
        }
    "#;
    let response: serde_json::Value = serde_json::from_str(
        &api.graphql_execute(request(query, &fixture["variables"]))
            .await,
    )
    .expect("decode GraphQL parity response");

    assert_eq!(response.get("errors"), None, "GraphQL errors: {response:#}");
    assert_eq!(response["data"], fixture["rest"]);
}
