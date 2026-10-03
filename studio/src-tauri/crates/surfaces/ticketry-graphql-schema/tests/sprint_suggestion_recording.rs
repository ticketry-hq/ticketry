mod sprint_planning_support;
use sprint_planning_support::*;

use sea_orm::{ConnectionTrait, DbBackend, EntityTrait, IntoActiveModel, Schema};
use seaography::async_graphql::{Request, Variables};
use serde_json::json;
use ticketry_entities::{agent_run, sprint_suggestion};
use ticketry_work_management::{record_for_run, SprintStorySuggestion};

async fn rotate_run(f: &Fixture) {
    f.db.execute_raw(
        DbBackend::Sqlite
            .build(&Schema::new(DbBackend::Sqlite).create_table_from_entity(agent_run::Entity)),
    )
    .await
    .unwrap();
    f.db.execute_unprepared(
        "INSERT INTO agent_runs (id, issue_id, status, started_at, scope, launch_unattended)
         VALUES ('next-run', '50000000000000000000000000000001', 'running',
                 '2026-10-04T00:00:00Z', 'task', 0)",
    )
    .await
    .unwrap();
    let response = f
        .schema
        .execute(Request::new(
            "mutation($id: String!) { update_sprint(id: $id, suggestion_run_id: \"next-run\") { id } }",
        ).variables(Variables::from_json(json!({"id": SPRINT}))))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
}

#[tokio::test]
async fn reruns_keep_dismissed_existing_stories_and_proposals_out_of_waiting() {
    for story in [
        proposal(),
        SprintStorySuggestion::Existing {
            issue_id: STORY.into(),
        },
    ] {
        let f = fixture().await;
        let dismissed = record(&f, story.clone()).await;
        update(&f, &dismissed.id, "dismissed", None).await;
        rotate_run(&f).await;
        let before = snapshot(&f).await;
        let result = record_for_run(&f.db, PROJECT, "next-run", input(story))
            .await
            .unwrap();
        assert_eq!(result.id, dismissed.id);
        assert_eq!(result.status, "dismissed");
        assert_eq!(snapshot(&f).await, before);
    }
}

#[tokio::test]
async fn reruns_preserve_an_accepted_proposal_without_creating_a_second_draft() {
    let f = fixture().await;
    let accepted = record(&f, proposal()).await;
    update(&f, &accepted.id, "accepted", None).await;
    rotate_run(&f).await;
    let before = snapshot(&f).await;
    let result = record_for_run(&f.db, PROJECT, "next-run", input(proposal()))
        .await
        .unwrap();
    assert_eq!(result.id, accepted.id);
    assert_eq!(result.status, "accepted");
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn reruns_preserve_an_accepted_existing_story_and_prune_only_waiting_rows() {
    let f = fixture().await;
    let story = SprintStorySuggestion::Existing {
        issue_id: STORY.into(),
    };
    let row = record(&f, story.clone()).await;
    update(&f, &row.id, "accepted", None).await;
    let reviewed = snapshot(&f).await;
    record(&f, proposal()).await;
    rotate_run(&f).await;
    assert_eq!(snapshot(&f).await, reviewed);

    let result = record_for_run(&f.db, PROJECT, "next-run", input(story))
        .await
        .unwrap();
    assert_eq!(result, reviewed.3[0]);
    assert_eq!(result.status, "accepted");
    assert_eq!(snapshot(&f).await, reviewed);
}

#[tokio::test]
async fn reviewed_proposals_match_trimmed_case_normalized_titles_but_keep_epic_identity() {
    for status in ["accepted", "dismissed"] {
        let f = fixture().await;
        let row = record(&f, proposal()).await;
        update(&f, &row.id, status, None).await;
        rotate_run(&f).await;
        let before = snapshot(&f).await;
        let normalized = SprintStorySuggestion::Proposal {
            name: "  pRoPoSeD  ".into(),
            epic_id: Some(EPIC.into()),
        };
        let result = record_for_run(&f.db, PROJECT, "next-run", input(normalized))
            .await
            .unwrap();
        assert_eq!(result, before.3[0]);
        assert_eq!(snapshot(&f).await, before);

        let mut other_epic = before
            .0
            .iter()
            .find(|item| item.r#type == "module")
            .unwrap()
            .clone();
        other_epic.id = "50000000000000000000000000000003".into();
        other_epic.sequence_id = 100;
        ticketry_entities::issue::Entity::insert(other_epic.clone().into_active_model())
            .exec(&f.db)
            .await
            .unwrap();
        let issues_before = snapshot(&f).await.0;
        let result = record_for_run(
            &f.db,
            PROJECT,
            "next-run",
            input(SprintStorySuggestion::Proposal {
                name: "  PROPOSED  ".into(),
                epic_id: Some(other_epic.id.clone()),
            }),
        )
        .await
        .unwrap();
        assert_ne!(result.id, row.id);
        assert_eq!(result.status, "waiting");
        assert_eq!(result.proposed_epic_id, Some(other_epic.id));
        assert_eq!(snapshot(&f).await.0, issues_before);
        let suggestions = snapshot(&f).await.3;
        assert_eq!(suggestions.len(), 2);
        assert_eq!(
            suggestions.iter().find(|item| item.id == row.id).unwrap(),
            &before.3[0]
        );
    }
}

#[tokio::test]
async fn reviewed_matches_still_require_a_goal_in_the_current_sprint() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    update(&f, &row.id, "dismissed", None).await;
    rotate_run(&f).await;
    let before = snapshot(&f).await;
    f.db.execute_unprepared(
        "INSERT INTO worktracker_sprint_goal
        (id, sprint_id, position, text, created_at, updated_at) VALUES
        ('30000000000000000000000000000002', '10000000000000000000000000000002', 1,
         'Other sprint goal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    .await
    .unwrap();
    let mut wrong_goal = input(proposal());
    wrong_goal.goal_id = "30000000-0000-0000-0000-000000000002".into();
    assert!(record_for_run(&f.db, PROJECT, "next-run", wrong_goal)
        .await
        .is_err());
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn identical_edited_proposal_acceptance_is_safe_to_retry() {
    let f = fixture().await;
    let row = record(&f, proposal()).await;
    let original_name = "  Edited  ";
    let original_variables = json!({"id": row.id, "status": "accepted", "name": original_name});
    let committed = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(original_variables.clone())))
        .await;
    assert!(committed.errors.is_empty(), "{:?}", committed.errors);
    drop(committed);
    let before = snapshot(&f).await;
    let accepted = before.3.iter().find(|item| item.id == row.id).unwrap();
    let story_id = accepted.issue_id.as_ref().unwrap();
    assert_eq!(accepted.status, "accepted");
    assert_eq!(accepted.proposed_name.as_deref(), Some("Edited"));
    assert_eq!(before.0.len(), 3);
    assert_eq!(before.2.len(), 2);
    let response = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(original_variables)))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let retry = response.data.into_json().unwrap()["update_sprint_suggestion"].clone();
    assert_eq!(retry["id"].as_str().unwrap().replace('-', ""), row.id);
    assert_eq!(
        retry["issueId"].as_str().unwrap().replace('-', ""),
        *story_id
    );
    assert_eq!(retry["issue"]["name"], "Edited");
    assert_eq!(retry["issue"]["sprintId"], SPRINT);
    assert_eq!(snapshot(&f).await, before);
    let trimmed_retry = update(&f, &row.id, "accepted", Some("Edited")).await;
    assert_eq!(trimmed_retry, retry);
    assert_eq!(snapshot(&f).await, before);
    let changed = f
        .schema
        .execute(Request::new(UPDATE).variables(Variables::from_json(
            json!({"id": row.id, "status": "accepted", "name": "Different"}),
        )))
        .await;
    assert!(!changed.errors.is_empty());
    assert_eq!(snapshot(&f).await, before);
}

#[tokio::test]
async fn recording_and_acceptance_reject_non_stories_and_archived_stories() {
    for change in [
        "UPDATE worktracker_issuetype SET name = 'Implementation'",
        "UPDATE worktracker_issue SET is_archived = 1 WHERE type = 'task'",
    ] {
        let f = fixture().await;
        let story = SprintStorySuggestion::Existing {
            issue_id: STORY.into(),
        };
        let row = record(&f, story.clone()).await;
        f.db.execute_unprepared(change).await.unwrap();
        let before = snapshot(&f).await;
        assert!(record_for_run(&f.db, PROJECT, RUN, input(story))
            .await
            .is_err());
        let response = f
            .schema
            .execute(Request::new(UPDATE).variables(Variables::from_json(
                json!({"id": row.id, "status": "accepted"}),
            )))
            .await;
        assert!(!response.errors.is_empty());
        assert_eq!(snapshot(&f).await, before);
        assert_eq!(
            sprint_suggestion::Entity::find()
                .all(&f.db)
                .await
                .unwrap()
                .len(),
            1
        );
    }
}
