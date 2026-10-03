use super::{output::SuggestionOutput, publication, test_fixture::*};
use sea_orm::{ConnectionTrait, EntityTrait};
use ticketry_entities::{agent_execution, issue, sprint_suggestion};
fn result(story: &str) -> SuggestionOutput {
    SuggestionOutput::parse(
        serde_json::to_vec(&serde_json::json!({"suggestions":[{
            "goal_id":GOAL,"story":{"kind":"existing","issue_id":story},"reason":"Fits the goal"}
        ]}))
        .unwrap()
        .as_slice(),
    )
    .unwrap()
}
#[tokio::test]
async fn publishes_once_without_assigning_a_story() {
    let (db, dir) = fixture().await;
    let (service, job, snapshot) = running(&db, dir.path()).await;
    publication::publish(&service, &job, &snapshot, result(STORY))
        .await
        .unwrap();
    assert_eq!(
        agent_execution::Entity::find_by_id(&job.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap()
            .state,
        "succeeded"
    );
    let suggestions = sprint_suggestion::Entity::find().all(&db).await.unwrap();
    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].status, "waiting");
    assert!(issue::Entity::find_by_id(STORY)
        .one(&db)
        .await
        .unwrap()
        .unwrap()
        .sprint_id
        .is_none());
    assert!(
        publication::publish(&service, &job, &snapshot, result(STORY))
            .await
            .is_err()
    );
    assert_eq!(
        sprint_suggestion::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .len(),
        1
    );
}
#[tokio::test]
async fn changed_goals_cancelled_runs_and_invalid_batches_publish_nothing() {
    for conflict in ["goals", "cancel", "invalid"] {
        let (db, dir) = fixture().await;
        let (service, job, snapshot) = running(&db, dir.path()).await;
        match conflict {
            "goals" => {
                db.execute_unprepared(
                    "UPDATE worktracker_sprint SET goals_revised_at='2026-10-04 12:00:00'",
                )
                .await
                .unwrap();
            }
            "cancel" => {
                db.execute_unprepared(
                    "UPDATE agent_executions SET state='cancelled',cancel_requested=1",
                )
                .await
                .unwrap();
            }
            _ => {}
        }
        let mut output = result(STORY);
        if conflict == "invalid" {
            output.suggestions.extend(result(MODULE).suggestions);
        }
        assert!(publication::publish(&service, &job, &snapshot, output)
            .await
            .is_err());
        assert!(sprint_suggestion::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .is_empty());
    }
}
#[tokio::test]
async fn restart_fails_interrupted_execution_without_rerunning_it() {
    let (db, dir) = fixture().await;
    let (service, job, _) = running(&db, dir.path()).await;
    service.recover().await.unwrap();
    service.recover().await.unwrap();
    let row = agent_execution::Entity::find_by_id(&job.id)
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "failed");
    assert!(row.error.unwrap().contains("restarted"));
}
