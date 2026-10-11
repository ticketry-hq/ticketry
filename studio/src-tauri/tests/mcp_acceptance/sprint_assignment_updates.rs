use serde_json::{json, Value};

use super::fixture::{assert_sprint, create_arguments, task_id, Fixture, ACTIVE, PLANNED};

#[tokio::test]
async fn update_task_assigns_current_sprint_as_an_exclusive_patch() {
    let mut fixture = Fixture::new(true).await;
    let created = fixture
        .client
        .structured(1, "create_task", create_arguments("Move from backlog"))
        .await;
    let id = task_id(&created);
    let updated = fixture
        .client
        .structured(
            2,
            "update_task",
            json!({
                "id_or_key": id, "sprint": "current",
            }),
        )
        .await;
    assert_sprint(&updated, ACTIVE, "Current sprint", "active");
    assert_eq!(updated["task_id"], id);
    assert_eq!(updated["key"], "AUTH-1");
    assert_eq!(updated["updated_fields"], json!(["sprint"]));
    assert_eq!(fixture.task(&id).await["sprintId"], ACTIVE);
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn update_current_explicit_and_backlog_preserves_revision_on_same_sprint() {
    let mut fixture = Fixture::new(true).await;
    let mut arguments = create_arguments("Replan this story");
    arguments["sprint"] = json!(PLANNED);
    let created = fixture.client.structured(1, "create_task", arguments).await;
    let id = task_id(&created);
    for (index, selector, expected_id, name, status) in [
        (0, json!("current"), ACTIVE, "Current sprint", "active"),
        (1, json!("current"), ACTIVE, "Current sprint", "active"),
        (2, json!(ACTIVE), ACTIVE, "Current sprint", "active"),
        (
            3,
            json!(ACTIVE.replace('-', "")),
            ACTIVE,
            "Current sprint",
            "active",
        ),
        (4, json!(PLANNED), PLANNED, "Planned sprint", "planned"),
        (
            5,
            json!(PLANNED.replace('-', "")),
            PLANNED,
            "Planned sprint",
            "planned",
        ),
        (6, Value::Null, "", "", ""),
        (7, Value::Null, "", "", ""),
    ] {
        let before = fixture.snapshot().await;
        let previous = fixture.task(&id).await;
        let updated = fixture
            .client
            .structured(
                10 + index,
                "update_task",
                json!({
                    "id_or_key": "AUTH-1", "sprint": selector,
                }),
            )
            .await;
        let expected = if expected_id.is_empty() {
            Value::Null
        } else {
            json!(expected_id)
        };
        if expected.is_null() {
            assert_eq!(updated["ok"], true, "{updated:#}");
            assert_eq!(updated["sprint"], Value::Null, "{updated:#}");
        } else {
            assert_sprint(&updated, expected_id, name, status);
        }
        assert_eq!(updated["task_id"], id);
        assert_eq!(updated["key"], "AUTH-1");
        assert_eq!(updated["updated_fields"], json!(["sprint"]));
        let saved = fixture.task(&id).await;
        assert_eq!(saved["sprintId"], expected);
        if previous["sprintId"] == expected {
            assert_eq!(
                fixture.snapshot().await,
                before,
                "same-sprint assignment must be a no-op"
            );
        } else {
            assert!(
                saved["stateRevision"].as_i64().unwrap()
                    > previous["stateRevision"].as_i64().unwrap()
            );
        }
    }
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn omitted_sprint_keeps_membership_when_name_or_description_changes() {
    let mut fixture = Fixture::new(true).await;
    let mut arguments = create_arguments("Keep sprint membership");
    arguments["sprint"] = json!(PLANNED);
    let created = fixture.client.structured(1, "create_task", arguments).await;
    let id = task_id(&created);
    for (index, field, value) in [
        (0, "name", "Renamed without moving"),
        (1, "description", "Documented without moving"),
    ] {
        let mut arguments = json!({"id_or_key": id});
        arguments[field] = json!(value);
        let updated = fixture
            .client
            .structured(20 + index, "update_task", arguments)
            .await;
        assert_eq!(updated["ok"], true, "{updated:#}");
        assert_eq!(updated["updated_fields"], json!([field]));
        assert!(updated.get("sprint").is_none(), "{updated:#}");
        let saved = fixture.task(&id).await;
        assert_eq!(saved["sprintId"], PLANNED);
        assert_eq!(saved[field], value);
    }
    fixture.runtime.shutdown().await;
}
