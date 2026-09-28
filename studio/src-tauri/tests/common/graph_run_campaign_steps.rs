//! Campaign setup and evidence shared by the Graph Run launch-freshness tests.

use sea_orm::{ConnectionTrait, DatabaseConnection};
use ticketry_agent_execution::graph::{ExecutionMode, GraphAccess};
use ticketry_agent_execution::{GraphRunRequest, GraphRunService};

use super::graph_run_fixture::*;
use super::terminal_lifecycle_harness::{PROJECT_ID, TASK_ID};

pub const FRESH_MODEL: &str = "00000000000000000000000000008961";
pub const LATER_MODEL: &str = "00000000000000000000000000008964";

/// Arm a parallel campaign whose only live children, A and B, wait on an
/// external blocker, so the first automatic advancement launches both.
pub async fn arm_parallel_behind_external(
    database: &DatabaseConnection,
    service: &GraphRunService,
) {
    run(database, &format!(
        "UPDATE worktracker_issue SET is_archived=1 WHERE id IN ('{BLOCKED}','{READY}'); \
         INSERT INTO worktracker_issue_blocked_by(from_issue_id,to_issue_id) VALUES ('{CHILD_A}','{EXTERNAL}'),('{CHILD_B}','{EXTERNAL}')"
    ))
    .await;
    let armed = service
        .create_or_press(request(ExecutionMode::Parallel, None))
        .await
        .unwrap();
    assert!(armed.launched.is_empty());
}

/// Every claim points at the Agent Run its child's launch material prepared.
pub async fn assert_claims_match_material(database: &DatabaseConnection, children: &[&str]) {
    let claims = claim_runs(database).await;
    assert_eq!(claims.len(), children.len());
    for child in children {
        assert_eq!(
            claims[*child],
            prepared_launch(database, child).await.agent_run_id
        );
    }
}

pub fn request(mode: ExecutionMode, provider_override: Option<&str>) -> GraphRunRequest {
    GraphRunRequest {
        root_id: TASK_ID.to_owned(),
        access: GraphAccess::project(PROJECT_ID),
        mode: Some(mode),
        provider_override: provider_override.map(str::to_owned),
    }
}

pub fn codex_model(id: &str, name: &str) -> String {
    format!(
        "INSERT INTO worktracker_agentmodel(id,provider_id,name) \
         SELECT '{id}',provider_id,'{name}' FROM worktracker_agentmodel WHERE id='{MODEL}'"
    )
}

pub async fn run(database: &DatabaseConnection, sql: &str) {
    database.execute_unprepared(sql).await.unwrap();
}
