use serde_json::{json, Value};
use ticketry_mcp::PROJECT;

use super::super::MODULE;
use super::fixture::{create_arguments, task_id, Fixture, COMPLETED, FOREIGN, PLANNED, UNKNOWN};

async fn assert_selector_rollback(fixture: &mut Fixture, selector: Value, code: &str, field: bool) {
    let mut arguments = create_arguments("Existing planned story");
    arguments["sprint"] = json!(PLANNED);
    let created = fixture.client.structured(1, "create_task", arguments).await;
    let id = task_id(&created);
    let before = fixture.snapshot().await;
    let mut create = create_arguments("Rejected sprint story");
    create["sprint"] = selector.clone();
    for (request_id, tool, arguments) in [
        (2, "create_task", create),
        (
            3,
            "create_sub_task",
            json!({
                "project_id": PROJECT, "parent_id": id, "name": "Rejected sprint child",
                "issue_type": "Implementation", "sprint": selector,
            }),
        ),
        (
            4,
            "update_task",
            json!({"id_or_key": id, "sprint": selector}),
        ),
    ] {
        let rejected = fixture.client.structured(request_id, tool, arguments).await;
        assert_eq!(rejected["ok"], false, "{tool}: {rejected:#}");
        assert_eq!(rejected["code"], code, "{tool}: {rejected:#}");
        if field {
            assert_eq!(rejected["field"], "sprint", "{tool}: {rejected:#}");
        }
        assert_eq!(
            fixture.snapshot().await,
            before,
            "{tool} rejection must preserve tickets, membership and counters: {rejected:#}"
        );
    }
}

#[tokio::test]
async fn current_without_an_active_project_sprint_rolls_back_every_write_tool() {
    let mut fixture = Fixture::new(false).await;
    assert_selector_rollback(&mut fixture, json!("current"), "no_active_sprint", true).await;
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn next_without_a_planned_project_sprint_rolls_back_every_write_tool() {
    for active in [true, false] {
        let mut fixture = Fixture::without_planned(active).await;
        let mut arguments = create_arguments("Keep existing membership");
        if active {
            arguments["sprint"] = json!("current");
        }
        let existing = fixture.client.structured(1, "create_task", arguments).await;
        let id = task_id(&existing);
        let before = fixture.snapshot().await;
        let mut create = create_arguments("Cannot queue without a next sprint");
        create["sprint"] = json!("next");
        for (request_id, tool, arguments) in [
            (2, "create_task", create),
            (
                3,
                "create_sub_task",
                json!({
                    "project_id": PROJECT, "parent_id": id,
                    "name": "Cannot queue this child", "issue_type": "Implementation", "sprint": "next",
                }),
            ),
            (4, "update_task", json!({"id_or_key": id, "sprint": "next"})),
        ] {
            let rejected = fixture.client.structured(request_id, tool, arguments).await;
            assert_eq!(rejected["ok"], false, "{tool}: {rejected:#}");
            assert_eq!(rejected["code"], "no_next_sprint", "{tool}: {rejected:#}");
            assert_eq!(rejected["field"], "sprint", "{tool}: {rejected:#}");
            assert_eq!(fixture.snapshot().await, before,
                "{tool} rejection must preserve tickets, membership, revisions and counters: {rejected:#}");
        }
        fixture.runtime.shutdown().await;
    }
}

#[tokio::test]
async fn unavailable_and_malformed_sprints_return_distinct_codes_without_changes() {
    let mut fixture = Fixture::new(true).await;
    for (selector, code, field) in [
        (json!(COMPLETED), "completed_sprint", true),
        (json!(FOREIGN), "foreign_sprint", true),
        (json!(UNKNOWN), "not_found", false),
        (json!("not-a-sprint"), "field_validation", true),
        (json!(37), "field_validation", true),
        (json!({"selector": "current"}), "field_validation", true),
    ] {
        assert_selector_rollback(&mut fixture, selector, code, field).await;
    }
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn module_level_create_and_update_cannot_join_a_sprint() {
    let mut fixture = Fixture::new(true).await;
    let before = fixture.snapshot().await;
    for (id, tool, arguments) in [
        (
            1,
            "create_task",
            json!({
                "project_id": PROJECT, "name": "Rejected sprint module",
                "issue_type": "Module", "sprint": "current",
            }),
        ),
        (
            2,
            "update_task",
            json!({"id_or_key": MODULE, "sprint": "current"}),
        ),
    ] {
        let rejected = fixture.client.structured(id, tool, arguments).await;
        assert_eq!(rejected["ok"], false, "{rejected:#}");
        assert_eq!(rejected["code"], "not_found", "{rejected:#}");
        assert_eq!(fixture.snapshot().await, before, "{rejected:#}");
    }
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn sprint_patch_with_name_or_description_is_rejected_atomically() {
    let mut fixture = Fixture::new(true).await;
    let mut arguments = create_arguments("Keep original name");
    arguments["description"] = json!("Keep original description");
    arguments["sprint"] = json!(PLANNED);
    let created = fixture.client.structured(1, "create_task", arguments).await;
    let id = task_id(&created);
    let before = fixture.snapshot().await;
    for (index, patch) in [
        json!({"name": "Forbidden rename"}),
        json!({"description": "Forbidden description"}),
        json!({"name": "Forbidden rename", "description": "Forbidden description"}),
        json!({"name": null}),
        json!({"description": null}),
    ]
    .into_iter()
    .enumerate()
    {
        let mut arguments = json!({"id_or_key": id, "sprint": "current"});
        arguments
            .as_object_mut()
            .unwrap()
            .extend(patch.as_object().unwrap().clone());
        let rejected = fixture
            .client
            .structured(10 + index as u64, "update_task", arguments)
            .await;
        assert_eq!(rejected["ok"], false, "{rejected:#}");
        assert_eq!(rejected["code"], "mixed_sprint_update", "{rejected:#}");
        assert_eq!(
            fixture.snapshot().await,
            before,
            "mixed patch must preserve name, description and sprint: {rejected:#}"
        );
    }
    fixture.runtime.shutdown().await;
}
