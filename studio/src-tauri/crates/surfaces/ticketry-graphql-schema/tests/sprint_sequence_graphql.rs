mod sprint_planning_support;

use seaography::async_graphql::Request;
use serde_json::Value;
use sprint_planning_support::{fixture, Fixture, PROJECT, SPRINT, STORY};

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

async fn status(f: &Fixture, id: &str, status: &str) -> Value {
    execute(f, format!(r#"mutation {{ update_sprint(id: "{id}", status: "{status}") {{ id name status rank }} }}"#)).await["update_sprint"].clone()
}

#[tokio::test]
async fn newly_created_sprints_append_to_the_persisted_project_sequence() {
    let f = fixture().await;
    let first = create(&f, "Second").await;
    let second = create(&f, "Third").await;
    let ordered = sequence(&f).await;
    assert_eq!(
        ordered
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Sprint", "Second", "Third"]
    );
    assert!(ordered[0]["rank"].as_str().unwrap() < first["rank"].as_str().unwrap());
    assert!(first["rank"].as_str().unwrap() < second["rank"].as_str().unwrap());
}

#[tokio::test]
async fn starting_a_later_planned_sprint_places_it_directly_after_completed_history() {
    let f = fixture().await;
    status(&f, SPRINT, "active").await;
    status(&f, SPRINT, "completed").await;
    let next = create(&f, "Next").await;
    let later = create(&f, "Later").await;
    let started = status(&f, later["id"].as_str().unwrap(), "active").await;
    let ordered = sequence(&f).await;
    assert_eq!(
        ordered
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Sprint", "Later", "Next"]
    );
    assert_eq!(started["status"], "active");
    assert_ne!(started["rank"], later["rank"]);
    assert_eq!(ordered[2]["rank"], next["rank"]);
    assert_eq!(ordered[1]["rank"], started["rank"]);
}

#[tokio::test]
async fn completion_preserves_every_rank_with_or_without_carryover() {
    for carryover in [false, true] {
        let f = fixture().await;
        let next = create(&f, "Next").await;
        let destination = next["id"].as_str().unwrap();
        execute(
            &f,
            format!(
                r#"mutation {{ update_work_item(id: "{STORY}", sprint_id: "{SPRINT}") {{ id }} }}"#
            ),
        )
        .await;
        let initial = sequence(&f).await;
        let started = status(&f, SPRINT, "active").await;
        assert_eq!(started["rank"], initial[0]["rank"]);
        let target = if carryover {
            format!(", carryover_sprint_id: \"{destination}\"")
        } else {
            String::new()
        };
        let completed = execute(&f, format!(r#"mutation {{ update_sprint(id: "{SPRINT}", status: "completed"{target}) {{ id status rank }} }}"#)).await;
        assert_eq!(completed["update_sprint"]["rank"], initial[0]["rank"]);
        let final_order = sequence(&f).await;
        for (before, after) in initial.iter().zip(&final_order) {
            assert_eq!(before["id"], after["id"]);
            assert_eq!(before["rank"], after["rank"]);
        }
        let membership = execute(&f, format!(r#"query {{ worktrackerIssue(filters: {{ id: {{ eq: "{STORY}" }} }}) {{ nodes {{ sprintId }} }} }}"#)).await;
        assert_eq!(
            membership["worktrackerIssue"]["nodes"][0]["sprintId"],
            if carryover {
                Value::String(destination.into())
            } else {
                Value::Null
            }
        );
    }
}

#[tokio::test]
async fn sprint_rank_is_readable_and_orderable_but_never_caller_writable() {
    let f = fixture().await;
    let contract = execute(
        &f,
        r#"query {
        create: __type(name: "WorktrackerSprintInsertInput") { inputFields { name } }
        order: __type(name: "WorktrackerSprintOrderInput") { inputFields { name } }
        sprint: __type(name: "WorktrackerSprint") { fields { name type { kind ofType { name } } } }
        __schema { mutationType { fields { name args { name } } } }
    }"#
        .into(),
    )
    .await;
    let mut create_fields = contract["create"]["inputFields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|field| field["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    create_fields.sort_unstable();
    assert_eq!(create_fields, ["name", "projectId"]);
    assert!(contract["order"]["inputFields"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field["name"] == "rank"));
    let rank = contract["sprint"]["fields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|field| field["name"] == "rank")
        .unwrap();
    assert_eq!(rank["type"]["kind"], "NON_NULL");
    assert_eq!(rank["type"]["ofType"]["name"], "String");
    let mutations = contract["__schema"]["mutationType"]["fields"]
        .as_array()
        .unwrap();
    let update = mutations
        .iter()
        .find(|field| field["name"] == "update_sprint")
        .unwrap();
    assert!(!update["args"]
        .as_array()
        .unwrap()
        .iter()
        .any(|arg| arg["name"] == "rank"));
    for name in [
        "worktrackerSprintCreateBatch",
        "worktrackerSprintUpdate",
        "worktrackerSprintDelete",
    ] {
        assert!(!mutations.iter().any(|field| field["name"] == name));
    }
    let before = sequence(&f).await;
    for query in [
        format!(
            r#"mutation {{ worktrackerSprintCreateOne(data: {{ projectId: "{PROJECT}", name: "Injected", rank: "A" }}) {{ id }} }}"#
        ),
        format!(r#"mutation {{ update_sprint(id: "{SPRINT}", rank: "A") {{ id }} }}"#),
    ] {
        assert!(!f
            .schema
            .execute(Request::new(query))
            .await
            .errors
            .is_empty());
    }
    assert_eq!(sequence(&f).await, before);
}
use sea_orm::ConnectionTrait;

async fn seed_history(f: &Fixture, id: &str) {
    let project = PROJECT.replace('-', "");
    f.db.execute_unprepared(&format!(
        "INSERT INTO worktracker_sprint
        (id, project_id, name, status, rank, created_at, updated_at) VALUES
        ('{id}', '{project}', 'History', 'completed', 'V', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ))
    .await
    .unwrap();
}

#[tokio::test]
async fn creation_repairs_duplicate_ranks_and_keeps_history_and_active_before_planned() {
    let f = fixture().await;
    seed_history(&f, "f0000000000000000000000000000001").await;
    let project = PROJECT.replace('-', "");
    f.db.execute_unprepared(&format!("INSERT INTO worktracker_sprint
        (id, project_id, name, status, rank, created_at, updated_at) VALUES
        ('00000000000000000000000000000001', '{project}', 'Active', 'active', 'V', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        .await.unwrap();
    create(&f, "Appended").await;
    let ordered = sequence(&f).await;
    assert_eq!(
        ordered
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["History", "Active", "Sprint", "Appended"]
    );
    assert!(ordered
        .windows(2)
        .all(|pair| pair[0]["rank"].as_str().unwrap() < pair[1]["rank"].as_str().unwrap()));
}

#[tokio::test]
async fn starting_a_sprint_repairs_duplicates_and_returns_its_repaired_rank() {
    let f = fixture().await;
    seed_history(&f, "00000000000000000000000000000001").await;
    let started = status(&f, SPRINT, "active").await;
    let ordered = sequence(&f).await;
    assert_eq!(ordered[0]["name"], "History");
    assert_eq!(ordered[1]["id"], SPRINT);
    assert!(ordered[0]["rank"].as_str().unwrap() < ordered[1]["rank"].as_str().unwrap());
    assert_ne!(started["rank"], "V");
    assert_eq!(started["rank"], ordered[1]["rank"]);
}

#[tokio::test]
async fn a_failed_create_rolls_back_duplicate_rank_repair_and_the_insert() {
    let f = fixture().await;
    seed_history(&f, "f0000000000000000000000000000001").await;
    let before = sequence(&f).await;
    let rejected = f.schema.execute(Request::new(format!(r#"mutation {{ worktrackerSprintCreateOne(data: {{ projectId: "{PROJECT}", name: "" }}) {{ id rank }} }}"#))).await;
    assert!(!rejected.errors.is_empty());
    assert_eq!(sequence(&f).await, before);
}

#[tokio::test]
async fn starting_a_later_sprint_without_history_places_it_before_other_planned_sprints() {
    let f = fixture().await;
    let later = create(&f, "Later").await;
    status(&f, later["id"].as_str().unwrap(), "active").await;
    let ordered = sequence(&f).await;
    assert_eq!(ordered[0]["name"], "Later");
    assert_eq!(ordered[0]["status"], "active");
    assert_eq!(ordered[1]["id"], SPRINT);
    assert!(ordered[0]["rank"].as_str().unwrap() < ordered[1]["rank"].as_str().unwrap());
}
