//! Sprint discovery through the authenticated MCP socket.

use serde_json::json;
use ticketry_mcp::PROJECT;

use super::fixture::{Fixture, ACTIVE, FOREIGN_PROJECT, LATER, PLANNED};

#[tokio::test]
async fn list_sprints_returns_only_open_sprints_in_sequence_order_with_selection_flags() {
    if !crate::sprint_planning_edition() {
        return;
    }
    let mut fixture = Fixture::new(true).await;
    let tools = fixture
        .client
        .request(json!({"jsonrpc": "2.0", "id": 0, "method": "tools/list"}))
        .await;
    assert!(
        tools["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "list_sprints"),
        "{tools:#}"
    );
    let listed = fixture
        .client
        .structured(1, "list_sprints", json!({"project_id": PROJECT}))
        .await;
    assert_eq!(
        listed,
        json!({"sprints": [
            {"id": ACTIVE, "name": "Current sprint", "status": "active",
             "is_current": true, "is_next": false},
            {"id": PLANNED, "name": "Planned sprint", "status": "planned",
             "is_current": false, "is_next": true},
            {"id": LATER, "name": "Later sprint", "status": "planned",
             "is_current": false, "is_next": false},
        ]}),
        "{listed:#}"
    );
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn list_sprints_marks_next_without_an_active_sprint() {
    if !crate::sprint_planning_edition() {
        return;
    }
    let mut fixture = Fixture::new(false).await;
    let listed = fixture
        .client
        .structured(1, "list_sprints", json!({"project_id": PROJECT}))
        .await;
    assert_eq!(
        listed,
        json!({"sprints": [
            {"id": PLANNED, "name": "Planned sprint", "status": "planned",
             "is_current": false, "is_next": true},
            {"id": LATER, "name": "Later sprint", "status": "planned",
             "is_current": false, "is_next": false},
        ]}),
        "{listed:#}"
    );
    fixture.runtime.shutdown().await;
}

#[tokio::test]
async fn list_sprints_has_no_next_when_only_the_current_sprint_or_history_remains() {
    if !crate::sprint_planning_edition() {
        return;
    }
    for active in [true, false] {
        let mut fixture = Fixture::without_planned(active).await;
        let listed = fixture
            .client
            .structured(1, "list_sprints", json!({"project_id": PROJECT}))
            .await;
        let expected = if active {
            json!({"sprints": [{"id": ACTIVE, "name": "Current sprint", "status": "active",
                "is_current": true, "is_next": false}]})
        } else {
            json!({"sprints": []})
        };
        assert_eq!(listed, expected, "{listed:#}");
        fixture.runtime.shutdown().await;
    }
}

#[tokio::test]
async fn list_sprints_rejects_a_foreign_project_without_disclosing_its_sprints() {
    if !crate::sprint_planning_edition() {
        return;
    }
    let mut fixture = Fixture::new(true).await;
    let rejected = fixture
        .client
        .structured(1, "list_sprints", json!({"project_id": FOREIGN_PROJECT}))
        .await;
    assert_eq!(rejected["ok"], false, "{rejected:#}");
    assert_eq!(rejected["code"], "foreign_scope", "{rejected:#}");
    assert!(rejected.get("sprints").is_none(), "{rejected:#}");
    assert!(
        !rejected.to_string().contains("Foreign sprint"),
        "{rejected:#}"
    );
    fixture.runtime.shutdown().await;
}
