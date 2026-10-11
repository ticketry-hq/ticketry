//! The next selector follows the project's persisted sprint sequence.

use serde_json::json;
use ticketry_mcp::PROJECT;

use super::fixture::{assert_sprint, create_arguments, task_id, Fixture, ACTIVE, LATER, PLANNED};

#[tokio::test]
async fn next_write_tools_assign_first_planned_with_or_without_an_active_sprint() {
    for active in [true, false] {
        let mut fixture = Fixture::new(active).await;
        let mut arguments = create_arguments("Queue for the next sprint");
        arguments["sprint"] = json!("next");
        let created = fixture.client.structured(1, "create_task", arguments).await;
        assert_sprint(&created, PLANNED, "Planned sprint", "planned");
        let parent_id = task_id(&created);
        assert_eq!(fixture.task(&parent_id).await["sprintId"], PLANNED);

        let child = fixture.client.structured(2, "create_sub_task", json!({
            "project_id": PROJECT, "parent_id": parent_id,
            "name": "Child queued for next", "issue_type": "Implementation", "sprint": "next",
        })).await;
        assert_sprint(&child, PLANNED, "Planned sprint", "planned");
        let saved_child = fixture.task(&task_id(&child)).await;
        assert_eq!(saved_child["sprintId"], PLANNED);
        assert_eq!(saved_child["parentId"], parent_id);

        let backlog = fixture
            .client
            .structured(3, "create_task", create_arguments("Replan backlog"))
            .await;
        let id = task_id(&backlog);
        let updated = fixture
            .client
            .structured(
                4,
                "update_task",
                json!({
                    "id_or_key": id, "sprint": "next",
                }),
            )
            .await;
        assert_sprint(&updated, PLANNED, "Planned sprint", "planned");
        assert_eq!(updated["task_id"], id);
        assert_eq!(updated["updated_fields"], json!(["sprint"]));
        assert_eq!(fixture.task(&id).await["sprintId"], PLANNED);
        fixture.runtime.shutdown().await;
    }
}

#[tokio::test]
async fn reordering_planned_sprints_changes_discovery_and_every_next_write_tool() {
    for active in [true, false] {
        let mut fixture = Fixture::new(active).await;
        let mut arguments = create_arguments("Originally next");
        arguments["sprint"] = json!("next");
        let original = fixture.client.structured(1, "create_task", arguments).await;
        assert_sprint(&original, PLANNED, "Planned sprint", "planned");
        let original_id = task_id(&original);

        let reordered = fixture.schema.execute(format!(
            r#"mutation {{ reorder_sprint(sprint_id: "{LATER}", before_id: "{ACTIVE}", after_id: "{PLANNED}") {{ id }} }}"#
        )).await;
        assert!(reordered.errors.is_empty(), "{:?}", reordered.errors);
        assert_eq!(
            reordered.data.into_json().unwrap()["reorder_sprint"]["id"],
            LATER
        );

        let listed = fixture
            .client
            .structured(2, "list_sprints", json!({"project_id": PROJECT}))
            .await;
        let mut expected = vec![
            json!({"id": LATER, "name": "Later sprint", "status": "planned", "is_current": false, "is_next": true}),
            json!({"id": PLANNED, "name": "Planned sprint", "status": "planned", "is_current": false, "is_next": false}),
        ];
        if active {
            expected.insert(0, json!({"id": ACTIVE, "name": "Current sprint", "status": "active", "is_current": true, "is_next": false}));
        }
        assert_eq!(listed, json!({"sprints": expected}), "{listed:#}");

        let mut arguments = create_arguments("Newly next");
        arguments["sprint"] = json!("next");
        let created = fixture.client.structured(3, "create_task", arguments).await;
        assert_sprint(&created, LATER, "Later sprint", "planned");
        assert_eq!(fixture.task(&task_id(&created)).await["sprintId"], LATER);
        let child = fixture
            .client
            .structured(
                4,
                "create_sub_task",
                json!({
                    "project_id": PROJECT, "parent_id": original_id,
                    "name": "Newly next child", "issue_type": "Implementation", "sprint": "next",
                }),
            )
            .await;
        assert_sprint(&child, LATER, "Later sprint", "planned");
        assert_eq!(fixture.task(&task_id(&child)).await["sprintId"], LATER);
        let updated = fixture
            .client
            .structured(
                5,
                "update_task",
                json!({
                    "id_or_key": original_id, "sprint": "next",
                }),
            )
            .await;
        assert_sprint(&updated, LATER, "Later sprint", "planned");
        assert_eq!(fixture.task(&original_id).await["sprintId"], LATER);
        fixture.runtime.shutdown().await;
    }
}
