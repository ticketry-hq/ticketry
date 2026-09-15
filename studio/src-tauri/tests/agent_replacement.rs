mod common;

use std::sync::Arc;

use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID, TASK_RUN_ID,
};
use common::terminal_reconciliation_runtime::ScriptedRuntime;
use sea_orm::{ConnectionTrait, EntityTrait};
use ticketry_entities::{automation_attempt, issue, launch_policy_decision, session};
use ticketry_terminal::{CleanupRuntimeObservation, TerminalCleanupService, TerminalLaunchService};
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyDecision, ModuleLinkInput,
};

const ISSUE_TYPE: &str = "00000000-0000-0000-0000-000000008645";
const STATE: &str = "00000000-0000-0000-0000-000000008642";
const ROOT_ATTEMPT: &str = "a2000000000000000000000000000001";
const TRANSITION: &str = "b2000000000000000000000000000001";
const DECISION: &str = "c2000000000000000000000000000001";

#[tokio::test]
async fn a_replacing_delivery_ends_the_live_agent_before_launching_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed_attempt(&database).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(TASK_RUN_ID, [CleanupRuntimeObservation::Running]);
    let launch = TerminalLaunchService::new(database.clone(), runtime.clone());
    let cleanup = TerminalCleanupService::new(database.clone(), runtime.clone());
    let decision = recorded_decision(
        &database,
        CallerScope::AutoStart,
        TRANSITION,
        DECISION,
        harness.data_directory(),
    )
    .await;

    let fresh =
        ticketry_agent_execution::launch_delivery::execute(&database, &launch, &cleanup, &decision)
            .await
            .unwrap();

    assert!(session::Entity::find_by_id(TASK_RUN_ID)
        .one(&database)
        .await
        .unwrap()
        .unwrap()
        .terminated_at
        .is_some());
    assert_eq!(
        runtime.events(),
        [
            format!("kill:{TASK_RUN_ID}"),
            format!("launch:{}", fresh.agent_run_id)
        ]
    );
}

#[tokio::test]
async fn a_failed_kill_stops_launch_and_retry_kills_again_then_launches() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed_attempt(&database).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    runtime.set(TASK_RUN_ID, [CleanupRuntimeObservation::Running]);
    runtime.fail_kills(1);
    let launch = TerminalLaunchService::new(database.clone(), runtime.clone());
    let cleanup = TerminalCleanupService::new(database.clone(), runtime.clone());
    let first = recorded_decision(
        &database,
        CallerScope::AutoStart,
        TRANSITION,
        DECISION,
        harness.data_directory(),
    )
    .await;

    assert_eq!(
        ticketry_agent_execution::launch_delivery::execute(&database, &launch, &cleanup, &first,)
            .await
            .unwrap_err(),
        "previous_agent_not_ended"
    );
    assert_eq!(runtime.events(), [format!("kill:{TASK_RUN_ID}")]);
    assert_eq!(
        issue::Entity::find_by_id(compact(TASK_ID))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .state_id
            .as_deref(),
        Some(compact(STATE).as_str())
    );
    let failed = automation_attempt::Entity::find_by_id(ROOT_ATTEMPT)
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(failed.status, "failed");
    assert!(failed.retryable);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(failed.error_details.as_deref().unwrap())
            .unwrap()["code"],
        "previous_agent_not_ended"
    );
    assert!(
        launch_policy_decision::Entity::find_by_id(compact(&first.decision_id))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .delivered_at
            .is_some()
    );

    let retry = ticketry_runs::RunsServices::new(database.clone())
        .attempts()
        .retry(ROOT_ATTEMPT)
        .await
        .unwrap();
    let retry_decision = recorded_decision(
        &database,
        CallerScope::Retry,
        &retry.attempt_id,
        "d2000000000000000000000000000001",
        harness.data_directory(),
    )
    .await;
    let fresh = ticketry_agent_execution::launch_delivery::execute(
        &database,
        &launch,
        &cleanup,
        &retry_decision,
    )
    .await
    .unwrap();

    assert_eq!(
        runtime.events(),
        [
            format!("kill:{TASK_RUN_ID}"),
            format!("kill:{TASK_RUN_ID}"),
            format!("launch:{}", fresh.agent_run_id)
        ]
    );
}

async fn recorded_decision(
    database: &sea_orm::DatabaseConnection,
    caller_scope: CallerScope,
    idempotency_key: &str,
    decision_id: &str,
    directory: &std::path::Path,
) -> LaunchPolicyDecision {
    launch_policy::record(
        database,
        &LaunchPolicyDecision {
            version: 2,
            decision_id: decision_id.to_owned(),
            policy_identity: "binding:replacement-test".to_owned(),
            policy_version: 1,
            caller_scope,
            idempotency_key: idempotency_key.to_owned(),
            handoff: false,
            task_id: TASK_ID.to_owned(),
            project_id: PROJECT_ID.to_owned(),
            issue_type_id: ISSUE_TYPE.to_owned(),
            state_id: STATE.to_owned(),
            state_name: Some("Todo".to_owned()),
            prompt: "Continue the task.".to_owned(),
            required_skills: Vec::new(),
            entry_skill: None,
            provider: "codex".to_owned(),
            profile: None,
            model: None,
            reasoning: None,
            module_link: ModuleLinkInput {
                module_id: MODULE_ID.to_owned(),
                path: Some(directory.display().to_string()),
            },
        },
    )
    .await
    .unwrap()
}

async fn seed_attempt(database: &sea_orm::DatabaseConnection) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO automation_attempts (\
                id,transition_id,issue_id,from_state_id,to_state_id,workflow_revision,\
                status,retryable,created_at,updated_at\
             ) VALUES (\
                '{ROOT_ATTEMPT}','{TRANSITION}','{}','{}','{}',0,\
                'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\
             )",
            compact(TASK_ID),
            compact(STATE),
            compact(STATE),
        ))
        .await
        .unwrap();
}

fn compact(value: &str) -> String {
    value.replace('-', "")
}
