use serde_json::{json, Value};
use ticketry_mcp::PROJECT;

use super::fixture::{assert_sprint, create_arguments, task_id, Fixture, ACTIVE, PLANNED};

#[tokio::test]
async fn create_and_subtask_accept_current_and_both_explicit_uuid_shapes() {
    let mut fixture = Fixture::new(true).await;
    let parent = fixture
        .client
        .structured(1, "create_task", create_arguments("Parent story"))
        .await;
    let parent_id = task_id(&parent);
    let selectors = [
        ("current".to_owned(), ACTIVE, "Current sprint", "active"),
        (PLANNED.to_owned(), PLANNED, "Planned sprint", "planned"),
        (
            PLANNED.replace('-', ""),
            PLANNED,
            "Planned sprint",
            "planned",
        ),
    ];
    for (index, (selector, expected_id, name, status)) in selectors.into_iter().enumerate() {
        let mut args = create_arguments(&format!("Assigned story {index}"));
        args["sprint"] = json!(selector);
        let created = fixture
            .client
            .structured(10 + index as u64, "create_task", args)
            .await;
        assert_sprint(&created, expected_id, name, status);
        assert_eq!(created["key"], format!("AUTH-{}", index * 2 + 2));
        let created_id = task_id(&created);
        let saved = fixture.task(&created_id).await;
        assert_eq!(saved["sprintId"], expected_id);

        let child = fixture.client.structured(20 + index as u64, "create_sub_task", json!({
            "project_id": PROJECT, "parent_id": parent_id,
            "name": format!("Assigned child {index}"), "issue_type": "Implementation", "sprint": selector,
        })).await;
        assert_sprint(&child, expected_id, name, status);
        assert_eq!(child["key"], format!("AUTH-{}", index * 2 + 3));
        let saved = fixture.task(&task_id(&child)).await;
        assert_eq!(saved["sprintId"], expected_id);
        assert_eq!(saved["parentId"], parent_id);
    }
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn create_without_sprint_or_with_null_preserves_the_legacy_uuid_result() {
    let mut fixture = Fixture::new(true).await;
    let mut parent_id = String::new();
    for (index, tool, explicit_null) in [
        (0, "create_task", false),
        (1, "create_task", true),
        (2, "create_sub_task", false),
        (3, "create_sub_task", true),
    ] {
        let mut args = create_arguments(&format!("Backlog item {index}"));
        if tool == "create_sub_task" {
            args.as_object_mut().unwrap().remove("module_id");
            args["parent_id"] = json!(parent_id);
            args["issue_type"] = json!("Implementation");
        }
        if explicit_null {
            args["sprint"] = Value::Null;
        }
        let created = fixture.client.structured(30 + index, tool, args).await;
        let id = created["result"]
            .as_str()
            .unwrap_or_else(|| panic!("{created:#}"));
        assert_eq!(created.as_object().unwrap().len(), 1, "{created:#}");
        assert_eq!(
            uuid::Uuid::parse_str(id).unwrap().hyphenated().to_string(),
            id
        );
        assert_eq!(fixture.task(id).await["sprintId"], Value::Null);
        if index == 0 {
            parent_id = id.to_owned();
        }
    }
    fixture.runtime.shutdown().await;
}
