//! Socket-level acceptance coverage for adding tags to a story.

use std::sync::Arc;

use sea_orm::{ConnectionTrait, Database};
use serde_json::json;

use super::{prepare_command_database, MissingTerminalRuntime, MODULE};
use ticketry_data_directory::DataDirectoryGuard;
use ticketry_mcp::{
    allowed_provider_operations, McpConfiguration, McpRuntime, SocketClient, PROJECT,
};

const FOREIGN_STORY: &str = "70000000-0000-0000-0000-000000000001";

async fn seed_foreign_story(directory: &tempfile::TempDir) {
    let database = Database::connect(format!(
        "sqlite:{}",
        directory.path().join("state.db").display()
    ))
    .await
    .expect("open MCP tag fixture");
    database
        .execute_unprepared(
            r#"
            INSERT INTO worktracker_project
                (id, name, slug, description, seq_counter, state_revision,
                 created_at, updated_at, onboarding_required)
            VALUES
                ('70000000000000000000000000000000',
                 'Foreign', 'OTHER', '', 1, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
            INSERT INTO worktracker_issuetype VALUES
                ('70000000000000000000000000000002',
                 '70000000000000000000000000000000',
                 'Story', 'task', '', 0, NULL, 0, 0,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue VALUES
                ('70000000000000000000000000000001',
                 '70000000000000000000000000000000', 'task',
                 '70000000000000000000000000000002', NULL, NULL, NULL, 0,
                 'Foreign story', 1, 0, 'A', '', '[]',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            "#,
        )
        .await
        .expect("seed a foreign story");
    database.close().await.expect("close MCP tag fixture");
}

#[tokio::test]
async fn add_task_tags_trims_deduplicates_and_is_idempotent_within_run_scope() {
    let directory = tempfile::tempdir().unwrap();
    prepare_command_database(&directory).await;
    seed_foreign_story(&directory).await;
    let ownership = DataDirectoryGuard::acquire(directory.path()).unwrap();
    let runtime = McpRuntime::start_for_test(
        McpConfiguration {
            database_path: directory.path().join("state.db"),
            media_root: directory.path().join("media"),
        },
        &ownership,
        Arc::new(MissingTerminalRuntime),
    )
    .await
    .unwrap();
    runtime
        .grant_for_test("run-valid", "valid", allowed_provider_operations(), false)
        .await
        .unwrap();
    let mut client =
        SocketClient::connect_run(runtime.socket_path(), "run-valid", "Bearer valid").await;

    let created = client
        .structured(
            1,
            "create_task",
            json!({
                "project_id": PROJECT,
                "module_id": MODULE,
                "name": "Tagged story",
                "issue_type": "Story"
            }),
        )
        .await;
    let story_id = created["result"]
        .as_str()
        .unwrap_or_else(|| panic!("create_task failed: {created:#}"));

    let added = client
        .structured(
            2,
            "add_task_tags",
            json!({
                "id_or_key": story_id,
                "tags": [" backend ", "", "backend", " Needs Review "]
            }),
        )
        .await;
    assert_eq!(added["ok"], true, "{added:#}");
    assert_eq!(added["task_id"], story_id, "{added:#}");
    assert_eq!(added["key"], "AUTH-1", "{added:#}");
    assert_eq!(added["tags"], json!(["Needs Review", "backend"]));

    let repeated = client
        .structured(
            3,
            "add_task_tags",
            json!({"id_or_key": "AUTH-1", "tags": ["backend", " backend "]}),
        )
        .await;
    assert_eq!(repeated["ok"], true, "{repeated:#}");
    assert_eq!(repeated["task_id"], story_id, "{repeated:#}");
    assert_eq!(repeated["key"], "AUTH-1", "{repeated:#}");
    assert_eq!(
        repeated["tags"],
        json!(["Needs Review", "backend"]),
        "a repeated additive call must preserve existing tags without duplicates"
    );

    let foreign = client
        .structured(
            4,
            "add_task_tags",
            json!({"id_or_key": FOREIGN_STORY, "tags": ["forbidden"]}),
        )
        .await;
    assert_eq!(foreign["code"], "foreign_scope", "{foreign:#}");

    runtime.shutdown().await;
}
