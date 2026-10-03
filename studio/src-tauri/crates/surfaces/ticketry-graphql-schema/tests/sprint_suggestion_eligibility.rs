mod sprint_planning_support;
use sprint_planning_support::*;

use sea_orm::ConnectionTrait;
use seaography::async_graphql::{Request, Variables};
use serde_json::json;
use ticketry_work_management::{record_for_run, SprintStorySuggestion};

const IMPLEMENTATION: &str = "INSERT INTO worktracker_issuetype
    (id, project_id, name, level, color, sort_order, start_state_id,
     workflow_revision, is_pathfind, created_at, updated_at)
    SELECT '70000000000000000000000000000002', project_id, 'Implementation',
           'task', color, 2, start_state_id, workflow_revision, is_pathfind,
           created_at, updated_at FROM worktracker_issuetype;
    UPDATE worktracker_issue SET issue_type_id = '70000000000000000000000000000002'
    WHERE id = '50000000000000000000000000000001'";

fn existing() -> SprintStorySuggestion {
    SprintStorySuggestion::Existing {
        issue_id: STORY.into(),
    }
}

#[tokio::test]
async fn invalid_initial_recording_preserves_empty_suggestions_membership_and_counters() {
    for change in [
        IMPLEMENTATION,
        "UPDATE worktracker_issue SET is_archived = 1 WHERE type = 'task'",
        "UPDATE worktracker_issue SET project_id = '20000000000000000000000000000002' WHERE type = 'task'",
        "UPDATE worktracker_issue SET sprint_id = '10000000000000000000000000000001' WHERE type = 'task'",
    ] {
        let f = fixture().await;
        f.db.execute_unprepared(change).await.unwrap();
        let before = snapshot(&f).await;
        assert!(before.3.is_empty());

        let error = record_for_run(&f.db, PROJECT, RUN, input(existing()))
            .await
            .unwrap_err();

        assert_eq!(error.code(), "field_validation");
        assert_eq!(error.field_name(), Some("issue_id"));
        let after = snapshot(&f).await;
        assert!(after.3.is_empty());
        assert_eq!(after, before, "invalid recording changed persisted state");
    }
}

#[tokio::test]
async fn accepting_a_story_that_became_ineligible_preserves_the_waiting_decision() {
    for change in [
        IMPLEMENTATION,
        "UPDATE worktracker_issue SET is_archived = 1 WHERE type = 'task'",
        "UPDATE worktracker_issue SET project_id = '20000000000000000000000000000002' WHERE type = 'task'",
        "UPDATE worktracker_issue SET type = 'module' WHERE type = 'task'",
        "UPDATE worktracker_issuetype SET project_id = '20000000000000000000000000000002'",
        "UPDATE worktracker_issuetype SET level = 'module'",
    ] {
        let f = fixture().await;
        let row = record(&f, existing()).await;
        f.db.execute_unprepared(change).await.unwrap();
        let before = snapshot(&f).await;

        let response = f
            .schema
            .execute(Request::new(UPDATE).variables(Variables::from_json(
                json!({"id": row.id, "status": "accepted"}),
            )))
            .await;

        assert!(!response.errors.is_empty(), "accepted after {change}");
        assert_eq!(
            response.errors[0].message,
            "Suggest a live Story in this project."
        );
        let after = snapshot(&f).await;
        assert_eq!(after.3.len(), 1);
        assert_eq!(after.3[0].status, "waiting");
        assert_eq!(after, before, "invalid acceptance changed state after {change}");
    }
}
