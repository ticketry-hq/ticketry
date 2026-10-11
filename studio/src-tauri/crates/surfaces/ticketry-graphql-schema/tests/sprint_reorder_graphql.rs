mod sprint_planning_support;

use sea_orm::ConnectionTrait;
use seaography::async_graphql::Request;
use serde_json::Value;
use sprint_planning_support::{fixture, Fixture, PROJECT, SPRINT};

async fn execute(f: &Fixture, query: String) -> Value {
    let response = f.schema.execute(Request::new(query)).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    response.data.into_json().unwrap()
}

async fn create(f: &Fixture, name: &str) -> Value {
    execute(f, format!(r#"mutation {{ worktrackerSprintCreateOne(data: {{ projectId: "{PROJECT}", name: "{name}" }}) {{ id name status rank }} }}"#)).await["worktrackerSprintCreateOne"].clone()
}

async fn sequence(f: &Fixture) -> Vec<Value> {
    execute(f, format!(r#"query {{ worktrackerSprint(filters: {{ projectId: {{ eq: "{PROJECT}" }} }}, orderBy: {{ rank: ASC, id: ASC }}) {{ nodes {{ id name status rank }} }} }}"#)).await["worktrackerSprint"]["nodes"].as_array().unwrap().clone()
}

fn reorder(id: &str, before: Option<&str>, after: Option<&str>) -> String {
    let neighbor = |name: &str, id: Option<&str>| {
        id.map(|id| format!(", {name}: \"{id}\""))
            .unwrap_or_default()
    };
    format!(
        r#"mutation {{ reorder_sprint(sprint_id: "{id}"{}{}) {{ id name status rank }} }}"#,
        neighbor("before_id", before),
        neighbor("after_id", after)
    )
}

#[tokio::test]
async fn planned_sprints_move_earlier_and_later_between_sequence_neighbors() {
    let f = fixture().await;
    let second = create(&f, "Second").await;
    let third = create(&f, "Third").await;
    let second_id = second["id"].as_str().unwrap();
    let third_id = third["id"].as_str().unwrap();
    let moved = execute(&f, reorder(third_id, Some(SPRINT), Some(second_id))).await;
    let ordered = sequence(&f).await;
    assert_eq!(
        ordered
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Sprint", "Third", "Second"]
    );
    assert_eq!(moved["reorder_sprint"], ordered[1]);
    execute(&f, reorder(third_id, Some(second_id), None)).await;
    assert_eq!(
        sequence(&f)
            .await
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Sprint", "Second", "Third"]
    );
}

#[tokio::test]
async fn moving_to_the_same_slot_returns_the_unchanged_sprint_and_revision() {
    let f = fixture().await;
    let second = create(&f, "Second").await;
    let third = create(&f, "Third").await;
    let second_id = second["id"].as_str().unwrap();
    let third_id = third["id"].as_str().unwrap();
    // Append ranks need not equal the midpoint of their current neighbors.
    let before = sequence(&f).await;
    let revision_before = revision(&f).await;
    let result = execute(&f, reorder(second_id, Some(SPRINT), Some(third_id))).await;
    assert_eq!(result["reorder_sprint"], before[1]);
    assert_eq!(sequence(&f).await, before);
    assert_eq!(revision(&f).await, revision_before);
}

async fn revision(f: &Fixture) -> Value {
    execute(f, format!(r#"query {{ worktrackerProject(filters: {{ id: {{ eq: "{PROJECT}" }} }}) {{ nodes {{ stateRevision }} }} }}"#)).await["worktrackerProject"]["nodes"][0]["stateRevision"].clone()
}

#[tokio::test]
async fn planned_sprints_cannot_land_before_completed_or_active_history() {
    for status in ["active", "completed"] {
        let f = fixture().await;
        execute(
            &f,
            format!(r#"mutation {{ update_sprint(id: "{SPRINT}", status: "active") {{ id }} }}"#),
        )
        .await;
        if status == "completed" {
            execute(
                &f,
                format!(
                    r#"mutation {{ update_sprint(id: "{SPRINT}", status: "completed") {{ id }} }}"#
                ),
            )
            .await;
        }
        let planned = create(&f, "Planned").await;
        let before = sequence(&f).await;
        let revision_before = revision(&f).await;
        let response = f
            .schema
            .execute(Request::new(reorder(
                planned["id"].as_str().unwrap(),
                None,
                Some(SPRINT),
            )))
            .await;
        assert!(
            !response.errors.is_empty(),
            "{status} history must precede planned sprints"
        );
        assert_eq!(sequence(&f).await, before);
        assert_eq!(revision(&f).await, revision_before);
    }
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
            assert_eq!(event.event_kind, "sprint.changed");
            assert_eq!(event.subject_kind, "sprint");
            assert_eq!(event.payload_version, 1);
            serde_json::from_str(&event.payload).unwrap()
        })
        .collect()
}

#[tokio::test]
async fn committed_reorder_publishes_one_sprint_fact_and_revision_and_retry_publishes_nothing() {
    let f = fixture().await;
    let second = create(&f, "Second").await;
    let second_id = second["id"].as_str().unwrap();
    let before = revision(&f).await.as_i64().unwrap();
    let mutation = reorder(second_id, None, Some(SPRINT));
    let moved = execute(&f, mutation.clone()).await["reorder_sprint"].clone();
    assert_eq!(revision(&f).await, before + 1);
    let facts = published(&f).await;
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0]["projectId"], PROJECT.replace('-', ""));
    assert_eq!(facts[0]["sprintId"], second_id.replace('-', ""));
    assert_eq!(facts[0]["changeKind"], "reordered");
    assert_eq!(facts[0]["revision"], before + 1);
    assert_eq!(facts[0]["rank"], moved["rank"]);
    execute(&f, mutation).await;
    assert_eq!(revision(&f).await, before + 1);
    assert_eq!(published(&f).await, facts);
}

#[tokio::test]
async fn active_and_completed_sprints_cannot_move_or_publish_changes() {
    for status in ["active", "completed"] {
        let f = fixture().await;
        let planned = create(&f, "Planned").await;
        execute(
            &f,
            format!(r#"mutation {{ update_sprint(id: "{SPRINT}", status: "active") {{ id }} }}"#),
        )
        .await;
        if status == "completed" {
            execute(
                &f,
                format!(
                    r#"mutation {{ update_sprint(id: "{SPRINT}", status: "completed") {{ id }} }}"#
                ),
            )
            .await;
        }
        let before = sequence(&f).await;
        let revision_before = revision(&f).await;
        let response = f
            .schema
            .execute(Request::new(reorder(
                SPRINT,
                Some(planned["id"].as_str().unwrap()),
                None,
            )))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(sequence(&f).await, before);
        assert_eq!(revision(&f).await, revision_before);
        assert!(published(&f).await.is_empty());
    }
}

#[tokio::test]
async fn invalid_neighbors_reject_without_changing_order_revision_or_facts() {
    let f = fixture().await;
    let second = create(&f, "Second").await;
    let third = create(&f, "Third").await;
    let fourth = create(&f, "Fourth").await;
    let second = second["id"].as_str().unwrap();
    let third = third["id"].as_str().unwrap();
    let fourth = fourth["id"].as_str().unwrap();
    let foreign = "10000000-0000-0000-0000-000000000099";
    f.db.execute_unprepared("INSERT INTO worktracker_project
        (id, name, slug, description, seq_counter, state_revision, created_at, updated_at, onboarding_required) VALUES
        ('20000000000000000000000000000099', 'Foreign', 'foreign', '', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0);
        INSERT INTO worktracker_sprint (id, project_id, name, status, rank, created_at, updated_at) VALUES
        ('10000000000000000000000000000099', '20000000000000000000000000000099', 'Foreign', 'planned', 'V', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);").await.unwrap();
    let before = sequence(&f).await;
    let revision_before = revision(&f).await;
    for query in [
        reorder(fourth, Some(SPRINT), Some(third)), // Second lies in the requested gap.
        reorder(fourth, Some(second), None),        // Missing after means sequence end.
        reorder(fourth, None, Some(second)),        // Missing before means sequence beginning.
        reorder(fourth, None, None),
        reorder(fourth, Some(foreign), Some(third)),
        reorder(fourth, Some(third), Some(foreign)),
        reorder(fourth, Some(fourth), None),
    ] {
        let response = f.schema.execute(Request::new(query)).await;
        assert!(!response.errors.is_empty());
        assert_eq!(sequence(&f).await, before);
        assert_eq!(revision(&f).await, revision_before);
        assert!(published(&f).await.is_empty());
    }
}

#[tokio::test]
async fn same_slot_with_duplicate_ranks_does_not_commit_hidden_repairs() {
    let f = fixture().await;
    create(&f, "Second").await;
    f.db.execute_unprepared("UPDATE worktracker_sprint SET rank = 'V'")
        .await
        .unwrap();
    let before = sequence(&f).await;
    let revision_before = revision(&f).await;
    let result = execute(
        &f,
        reorder(
            before[1]["id"].as_str().unwrap(),
            Some(before[0]["id"].as_str().unwrap()),
            None,
        ),
    )
    .await;
    assert_eq!(result["reorder_sprint"], before[1]);
    assert_eq!(sequence(&f).await, before);
    assert_eq!(revision(&f).await, revision_before);
    assert!(published(&f).await.is_empty());
}

#[tokio::test]
async fn a_real_move_repairs_duplicate_ranks_and_rejected_moves_roll_back_repairs() {
    let f = fixture().await;
    create(&f, "Second").await;
    create(&f, "Third").await;
    f.db.execute_unprepared("UPDATE worktracker_sprint SET rank = 'V'")
        .await
        .unwrap();
    let initial = sequence(&f).await;
    let last = initial[2]["id"].as_str().unwrap();
    let first = initial[0]["id"].as_str().unwrap();
    let middle = initial[1]["id"].as_str().unwrap();
    let invalid = f
        .schema
        .execute(Request::new(reorder(last, None, Some(middle))))
        .await;
    assert!(!invalid.errors.is_empty());
    assert_eq!(sequence(&f).await, initial);
    assert!(published(&f).await.is_empty());
    let before_revision = revision(&f).await.as_i64().unwrap();
    let moved = execute(&f, reorder(last, None, Some(first))).await;
    let ordered = sequence(&f).await;
    assert_eq!(
        ordered
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [last, first, middle]
    );
    assert!(ordered
        .windows(2)
        .all(|pair| pair[0]["rank"].as_str().unwrap() < pair[1]["rank"].as_str().unwrap()));
    assert_eq!(moved["reorder_sprint"], ordered[0]);
    assert_eq!(revision(&f).await, before_revision + 1);
    assert_eq!(published(&f).await.len(), 1);
}
