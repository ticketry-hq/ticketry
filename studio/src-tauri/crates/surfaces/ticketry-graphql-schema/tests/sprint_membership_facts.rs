mod sprint_planning_support;
use sprint_planning_support::*;

use seaography::async_graphql::Request;
use serde_json::Value;

async fn execute(f: &Fixture, query: String) -> Value {
    let result = f.schema.execute(Request::new(query)).await;
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    serde_json::to_value(result.data).unwrap()
}

async fn published(f: &Fixture) -> Vec<Value> {
    let runs = ticketry_runs::RunsServices::new(f.db.clone());
    let events = runs.outbox().events();
    events
        .replay(
            &PROJECT.replace('-', ""),
            0,
            events.high_water().await.unwrap(),
            100,
        )
        .await
        .unwrap()
        .into_iter()
        .map(|event| {
            assert_eq!(event.event_kind, "work_item.changed");
            assert_eq!(event.payload_version, 1);
            serde_json::from_str(&event.payload).unwrap()
        })
        .collect()
}

#[tokio::test]
async fn assigning_and_returning_work_publish_updated_membership_facts() {
    let f = fixture().await;
    for destination in [format!("\"{SPRINT}\""), "null".into()] {
        let row = execute(&f, format!(r#"mutation {{ update_work_item(id: "{STORY}", sprint_id: {destination}) {{ id sprintId }} }}"#)).await;
        assert_eq!(row["update_work_item"]["id"], STORY);
    }
    let facts = published(&f).await;
    assert_eq!(facts.len(), 2);
    for fact in facts {
        assert_eq!(fact["changeKind"], "updated");
        assert_eq!(fact["membershipChanged"], true);
        assert_eq!(fact["workItemId"], STORY.replace('-', ""));
    }
}

#[tokio::test]
async fn completion_carryover_publishes_updated_membership_facts_after_commit() {
    let f = fixture().await;
    let next = execute(&f, format!(r#"mutation {{ worktrackerSprintCreateOne(data: {{ projectId: "{PROJECT}", name: "Next" }}) {{ id }} }}"#)).await;
    let destination = next["worktrackerSprintCreateOne"]["id"].as_str().unwrap();
    execute(
        &f,
        format!(
            r#"mutation {{ update_work_item(id: "{STORY}", sprint_id: "{SPRINT}") {{ id }} }}"#
        ),
    )
    .await;
    execute(
        &f,
        format!(
            r#"mutation {{ update_sprint(id: "{SPRINT}", status: "active") {{ id status }} }}"#
        ),
    )
    .await;
    execute(&f, format!(r#"mutation {{ update_sprint(id: "{SPRINT}", status: "completed", carryover_sprint_id: "{destination}") {{ id status }} }}"#)).await;
    let facts = published(&f).await;
    assert_eq!(facts.len(), 2);
    let carried = &facts[1];
    assert_eq!(carried["changeKind"], "updated");
    assert_eq!(carried["membershipChanged"], true);
    assert_eq!(carried["workItemId"], STORY.replace('-', ""));
    let assigned = execute(&f, format!(r#"query {{ worktrackerIssue(filters: {{ id: {{ eq: "{STORY}" }} }}) {{ nodes {{ sprintId }} }} }}"#)).await;
    assert_eq!(
        assigned["worktrackerIssue"]["nodes"][0]["sprintId"],
        destination
    );
}
