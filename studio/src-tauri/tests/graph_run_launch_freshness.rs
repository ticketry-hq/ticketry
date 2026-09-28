//! Automatic Graph Run advancement resolves the root's current status binding
//! for each new attempt, while prepared attempts keep their launch material.

mod common;

use common::graph_run_fixture::*;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, PROJECT_ID, TASK_ID};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use ticketry_agent_execution::graph::{ExecutionMode, GraphAccess};
use ticketry_agent_execution::GraphRunRequest;

const FRESH_MODEL: &str = "00000000000000000000000000008959";

#[tokio::test]
async fn serial_advancement_launches_the_next_child_with_edited_model_and_prompt() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let first = service
        .create_or_press(request(Some(ExecutionMode::Serial)))
        .await
        .unwrap();
    assert_eq!(task_ids(&first), [CHILD_A]);
    let header = first.graph_run.launch_configuration.clone();
    let first_claim = claim_tuple(&database, CHILD_A).await;

    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_agentmodel(id,provider_id,name) \
                SELECT '{FRESH_MODEL}',provider_id,'fresh-model' FROM worktracker_agentmodel WHERE id='{MODEL}'; \
             UPDATE worktracker_launchbinding SET model_id='{FRESH_MODEL}', prompt='Edited policy.'; \
             UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{CHILD_A}'; \
             UPDATE agent_runs SET ended_at='ended' WHERE id='{run}'; \
             UPDATE agent_terminal_sessions SET terminated_at='ended' WHERE agent_run_id='{run}'",
            run = first_claim.1
        ))
        .await
        .unwrap();
    let advanced = service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        advanced
            .launched
            .iter()
            .map(|child| child.task_id.as_str())
            .collect::<Vec<_>>(),
        [CHILD_B]
    );

    assert_eq!(launch_model(&database, CHILD_B).await, "fresh-model");
    assert!(launch_prompt(&database, CHILD_B)
        .await
        .starts_with("Selected workflow prompt:\nEdited policy."));
    // The prepared first attempt, its claim, and the campaign header guard
    // are untouched by the edit.
    assert_eq!(
        launch_model(&database, CHILD_A).await,
        "graph-run-test-model"
    );
    assert!(launch_prompt(&database, CHILD_A)
        .await
        .starts_with("Selected workflow prompt:\nInitial policy."));
    assert_eq!(claim_tuple(&database, CHILD_A).await, first_claim);
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM graph_runs").await,
        1
    );
    let stored = service.advance(TASK_ID).await.unwrap();
    assert!(stored.launched.is_empty());
    assert_eq!(header_configuration(&database).await, header);
}

#[tokio::test]
async fn invalid_current_policy_commits_nothing_and_repair_launches_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{CHILD_A}','{CHILD_B}','{READY}'); \
             INSERT INTO worktracker_issue_blocked_by(from_issue_id,to_issue_id) VALUES ('{BLOCKED}','{EXTERNAL}')"
        ))
        .await
        .unwrap();
    let service = service(&database);
    let armed = service
        .create_or_press(request(Some(ExecutionMode::Parallel)))
        .await
        .unwrap();
    assert!(armed.launched.is_empty());

    database
        .execute_unprepared(&format!(
            "UPDATE worktracker_launchbinding SET subtree_run_enabled=0, prompt='Repaired policy.'; \
             UPDATE worktracker_issue SET state_id='{REVIEW}' WHERE id='{EXTERNAL}'"
        ))
        .await
        .unwrap();
    let runs_before = scalar(&database, "SELECT COUNT(*) FROM agent_runs").await;
    let rejected = service.advance(TASK_ID).await.unwrap_err();
    assert_eq!(rejected.code_str(), "subtree_run_not_enabled");
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM agent_runs").await,
        runs_before
    );
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        0
    );

    database
        .execute_unprepared("UPDATE worktracker_launchbinding SET subtree_run_enabled=1")
        .await
        .unwrap();
    let repaired = service.advance(TASK_ID).await.unwrap();
    assert_eq!(
        repaired
            .launched
            .iter()
            .map(|child| child.task_id.as_str())
            .collect::<Vec<_>>(),
        [BLOCKED]
    );
    assert!(launch_prompt(&database, BLOCKED)
        .await
        .starts_with("Selected workflow prompt:\nRepaired policy."));
    assert!(service.advance(TASK_ID).await.unwrap().launched.is_empty());
    assert_eq!(
        scalar(&database, "SELECT COUNT(*) FROM launched_tasks").await,
        1
    );
}

fn request(mode: Option<ExecutionMode>) -> GraphRunRequest {
    GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode,
        provider_override: None,
    }
}

async fn launch_model(database: &DatabaseConnection, task_id: &str) -> String {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT model FROM terminal_launch_material WHERE task_id='{task_id}' ORDER BY created_at DESC LIMIT 1"
            ),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "model")
        .unwrap()
}

async fn header_configuration(database: &DatabaseConnection) -> Option<String> {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT launch_configuration FROM graph_runs".to_owned(),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "launch_configuration")
        .unwrap()
}
