//! Run Now converts the same Story to Implementation and launches with the
//! Implementation task's Implement configuration.

use std::sync::atomic::Ordering;

use sea_orm::{ConnectionTrait, EntityTrait, PaginatorTrait};
use ticketry_agent_execution::run_now::RunNowRefusal;
use ticketry_entities::{issue, launch_policy_decision, transition_occurrence};
use ticketry_work_management::commands::workflow::{self, TransitionOrigin, TransitionWorkItem};
use ticketry_work_management::launch_policy::LaunchPolicyDecision;

use super::run_now_fixture::*;

const BLOCKER: &str = "60000000000000000000000000000009";

async fn story(fixture: &Fixture) -> issue::Model {
    issue::Entity::find_by_id(TASK)
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap()
}

async fn recorded_decision(fixture: &Fixture) -> LaunchPolicyDecision {
    let row = launch_policy_decision::Entity::find()
        .one(&fixture.database)
        .await
        .unwrap()
        .unwrap();
    serde_json::from_str(&row.decision_json).unwrap()
}

async fn assert_unconverted(fixture: &Fixture, refusal: &RunNowRefusal) {
    assert!(refusal.committed_state.is_none());
    assert!(refusal.committed_issue_type.is_none());
    let story = story(fixture).await;
    assert_eq!(story.issue_type_id, STORY);
    assert_eq!(story.state_id.as_deref(), Some(IDEAS));
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 0);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn run_now_converts_the_same_item_and_launches_with_implementation_settings() {
    let fixture = fixture(None).await;
    fixture
        .database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET description = 'Keep this context' WHERE id = '{TASK}';
             INSERT INTO worktracker_issue VALUES
                 ('{BLOCKER}', '{PROJECT}', 'task', '{STORY}', '{MODULE}', '{MODULE}', '{IDEAS}',
                  4, 'Blocker', 11, 0, 'P', '', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
             INSERT INTO worktracker_issue_blocked_by (from_issue_id, to_issue_id)
                 VALUES ('{TASK}', '{BLOCKER}');
             UPDATE worktracker_launchbinding SET required_skills = '[\"missing-skill\"]'
                 WHERE issue_type_id = '{STORY}';"
        ))
        .await
        .unwrap();
    let before = story(&fixture).await;

    let success = fixture.service.execute(human(TASK)).await.unwrap();

    assert_eq!(success.committed_state.name, "Implement");
    assert_eq!(success.committed_issue_type.name, "Implementation");
    assert_eq!(
        success.committed_issue_type.id.replace('-', ""),
        IMPLEMENTATION
    );
    let after = story(&fixture).await;
    assert_eq!(after.issue_type_id, IMPLEMENTATION);
    assert_eq!(after.state_id.as_deref(), Some(IMPLEMENT));
    assert_eq!(
        (
            &after.id,
            after.sequence_id,
            &after.name,
            &after.description,
            &after.parent_id,
            &after.module_id,
            after.is_archived,
        ),
        (
            &before.id,
            before.sequence_id,
            &before.name,
            &before.description,
            &before.parent_id,
            &before.module_id,
            before.is_archived,
        )
    );
    assert!(after.state_revision > before.state_revision);
    assert_eq!(
        issue::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        3,
        "conversion never creates a replacement item"
    );
    let blockers = fixture
        .database
        .query_one_raw(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            format!(
                "SELECT COUNT(*) AS count FROM worktracker_issue_blocked_by \
                 WHERE from_issue_id = '{TASK}' AND to_issue_id = '{BLOCKER}'"
            ),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "count")
        .unwrap();
    assert_eq!(blockers, 1);

    let decision = recorded_decision(&fixture).await;
    assert_eq!(decision.issue_type_id.replace('-', ""), IMPLEMENTATION);
    assert_eq!(decision.prompt, "Implement this task.");
    assert_eq!(decision.model.as_deref(), Some("gpt-implementation"));
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn invalid_implementation_configuration_refuses_before_conversion() {
    let cases = [
        (
            format!(
                "DELETE FROM worktracker_launchbinding WHERE issue_type_id = '{IMPLEMENTATION}'"
            ),
            "binding_not_configured",
        ),
        (
            format!(
                "UPDATE worktracker_launchbinding SET required_skills = '[\"missing-skill\"]' \
                 WHERE issue_type_id = '{IMPLEMENTATION}'"
            ),
            "invalid_required_skills",
        ),
        (
            format!(
                "UPDATE worktracker_launchbinding SET model_id = '{MODEL}' \
                 WHERE issue_type_id = '{IMPLEMENTATION}'; \
                 DELETE FROM worktracker_agentmodel WHERE id = '{MODEL}'"
            ),
            "unsupported_model",
        ),
        (
            format!("DELETE FROM worktracker_issuetype WHERE id = '{IMPLEMENTATION}'"),
            "implementation_not_configured",
        ),
        (
            format!(
                "UPDATE worktracker_issuetype SET start_state_id = '{IDEAS}' \
                 WHERE id = '{IMPLEMENTATION}'"
            ),
            "implementation_not_configured",
        ),
    ];
    for (mutation, code) in cases {
        let fixture = fixture(None).await;
        fixture
            .database
            .execute_unprepared(&mutation)
            .await
            .unwrap();

        let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

        assert_eq!(refusal.code, code, "{mutation}");
        assert!(refusal.remedy.is_some(), "{code} explains its remedy");
        assert_unconverted(&fixture, &refusal).await;
    }
}

#[tokio::test]
async fn a_workflow_change_after_preflight_rolls_back_type_and_state() {
    for late_write in [
        format!(
            "UPDATE worktracker_issuetype SET workflow_revision = workflow_revision + 1 \
             WHERE id = '{IMPLEMENTATION}';"
        ),
        format!(
            "UPDATE worktracker_issuetype SET workflow_revision = workflow_revision + 1 \
             WHERE id = '{STORY}';"
        ),
        format!(
            "UPDATE worktracker_issue SET state_revision = state_revision + 1 WHERE id = '{TASK}';"
        ),
    ] {
        let fixture = fixture(None).await;
        // Policy recording sits between preflight and the guarded commit.
        fixture
            .database
            .execute_unprepared(&format!(
                "CREATE TRIGGER stale_after_preflight AFTER INSERT ON ticketry_launchpolicydecision \
                 BEGIN {late_write} END"
            ))
            .await
            .unwrap();

        let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

        assert_eq!(refusal.code, "transition_rejected", "{late_write}");
        assert_unconverted(&fixture, &refusal).await;
    }
}

#[tokio::test]
async fn a_destination_type_rename_after_preflight_refuses_without_conversion() {
    let fixture = fixture(None).await;
    fixture
        .database
        .execute_unprepared(&format!(
            "CREATE TRIGGER rename_implementation_after_preflight \
             AFTER INSERT ON ticketry_launchpolicydecision \
             BEGIN \
                 UPDATE worktracker_issuetype SET name = 'Delivery' \
                 WHERE id = '{IMPLEMENTATION}'; \
             END"
        ))
        .await
        .unwrap();

    let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

    assert_eq!(refusal.code, "transition_rejected");
    assert_unconverted(&fixture, &refusal).await;
}

#[tokio::test]
async fn a_source_type_rename_after_preflight_refuses_without_conversion() {
    let fixture = fixture(None).await;
    fixture
        .database
        .execute_unprepared(&format!(
            "CREATE TRIGGER rename_story_after_preflight \
             AFTER INSERT ON ticketry_launchpolicydecision \
             BEGIN \
                 UPDATE worktracker_issuetype SET name = 'Feature' \
                 WHERE id = '{STORY}'; \
             END"
        ))
        .await
        .unwrap();

    let refusal = fixture.service.execute(human(TASK)).await.unwrap_err();

    assert_eq!(refusal.code, "transition_rejected");
    assert_unconverted(&fixture, &refusal).await;
}

#[tokio::test]
async fn late_launch_failure_reports_the_conversion_and_same_request_recovers_it() {
    let fixture = fixture(Some("terminal_runtime_unavailable")).await;

    let failure = fixture.service.execute(human(TASK)).await.unwrap_err();

    assert_eq!(failure.code, "launch_unavailable");
    assert_eq!(failure.committed_state.unwrap().name, "Implement");
    assert_eq!(failure.committed_issue_type.unwrap().name, "Implementation");
    assert_eq!(story(&fixture).await.issue_type_id, IMPLEMENTATION);

    let mut fresh = human(TASK);
    fresh.request_identity = "fresh-request".to_owned();
    assert_eq!(
        fixture.service.execute(fresh).await.unwrap_err().code,
        "run_now_not_eligible",
        "a fresh request cannot adopt the earlier conversion"
    );

    let recovered = fixture.service.execute(human(TASK)).await.unwrap();
    assert_eq!(recovered.committed_issue_type.name, "Implementation");
    let replay = fixture.service.execute(human(TASK)).await.unwrap();
    assert_eq!(replay, recovered);
    assert_eq!(fixture.launches.load(Ordering::SeqCst), 2);
    assert_eq!(
        transition_occurrence::Entity::find()
            .count(&fixture.database)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn concurrent_requests_convert_once() {
    for distinct in [false, true] {
        let fixture = fixture(None).await;
        let mut second = human(TASK);
        if distinct {
            second.request_identity = "request-2".to_owned();
        }
        let (left, right) = tokio::join!(
            fixture.service.execute(human(TASK)),
            fixture.service.execute(second)
        );
        for success in [left, right].into_iter().flatten() {
            assert_eq!(success.committed_issue_type.name, "Implementation");
        }
        assert_eq!(story(&fixture).await.issue_type_id, IMPLEMENTATION);
        assert_eq!(fixture.launches.load(Ordering::SeqCst), 1);
        assert_eq!(
            issue::Entity::find()
                .count(&fixture.database)
                .await
                .unwrap(),
            2
        );
    }
}

#[tokio::test]
async fn an_ordinary_story_transition_keeps_the_story_type() {
    let fixture = fixture(None).await;

    workflow::transition(
        &fixture.database,
        TransitionWorkItem {
            id: TASK.to_owned(),
            target_state_id: IMPLEMENT.to_owned(),
            origin: TransitionOrigin::Human,
        },
        None,
    )
    .await
    .unwrap();

    let story = story(&fixture).await;
    assert_eq!(story.state_id.as_deref(), Some(IMPLEMENT));
    assert_eq!(story.issue_type_id, STORY);
}
