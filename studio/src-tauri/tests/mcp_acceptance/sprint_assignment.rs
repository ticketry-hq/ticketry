//! Sprint assignment through the provider's authenticated MCP socket.

#[path = "sprint_assignment_creation.rs"]
mod creation;
#[path = "sprint_discovery.rs"]
mod discovery;
#[path = "sprint_assignment_fixture.rs"]
mod fixture;
#[path = "sprint_assignment_next.rs"]
mod next;
#[path = "sprint_assignment_rejections.rs"]
mod rejections;
#[path = "sprint_assignment_updates.rs"]
mod updates;

use std::sync::Arc;

use sea_orm::{ConnectionTrait, Database};
use serde_json::{json, Value};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{
    allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient, PROJECT,
};

use super::{prepare_command_database, MissingTerminalRuntime, MODULE};

const ACTIVE: &str = "81000000-0000-0000-0000-000000000001";

async fn seed_sprints(directory: &tempfile::TempDir) {
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .unwrap();
    ticketry_work_management::install_sprint_rank_schema(&database)
        .await
        .unwrap();
    database
        .execute_unprepared(
            r#"
        INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at)
        VALUES ('81000000000000000000000000000001', '10000000000000000000000000000000',
                'Current sprint', 'active', 'A', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    "#,
        )
        .await
        .unwrap();
    database.close().await.unwrap();
}

async fn start_runtime(
    directory: &tempfile::TempDir,
    ownership: &DataDirectoryGuard,
) -> McpRuntime {
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    runtime
}

fn assert_sprint(result: &Value, id: &str, name: &str, status: &str) {
    assert_eq!(result["ok"], true, "{result:#}");
    assert_eq!(
        result["sprint"],
        json!({"id": id, "name": name, "status": status}),
        "{result:#}"
    );
}

#[tokio::test]
async fn create_task_assigns_current_sprint_and_returns_its_identity() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    seed_sprints(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = start_runtime(&directory, &ownership).await;
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;
    let created = client
        .structured(
            1,
            "create_task",
            json!({
                "project_id": PROJECT, "module_id": MODULE,
                "name": "Ship in current sprint", "issue_type": "Story", "sprint": "current",
            }),
        )
        .await;
    assert_sprint(&created, ACTIVE, "Current sprint", "active");
    assert_eq!(created["key"], "AUTH-1", "{created:#}");
    assert!(uuid::Uuid::parse_str(created["task_id"].as_str().unwrap()).is_ok());
    runtime.shutdown().await;
}
