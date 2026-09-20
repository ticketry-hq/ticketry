mod common;

use std::sync::Arc;

use common::terminal_lifecycle_harness::{
    TerminalLifecycleHarness, MODULE_ID, PROJECT_ID, TASK_ID, TASK_RUN_ID,
};
use common::terminal_reconciliation_runtime::ScriptedRuntime;
use sea_orm::{ActiveValue::NotSet, ConnectionTrait, EntityTrait, Set};
use ticketry_agent_execution::reconciliation::ExecutionReconciliationService;
use ticketry_entities::{
    agent_run, automation_attempt, issue, launch_material, launch_policy_decision, session,
};
use ticketry_terminal::{CleanupRuntimeObservation, TerminalCleanupService, TerminalLaunchService};
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyDecision, LaunchPolicyResolver, ModuleLinkInput,
};

const ISSUE_TYPE: &str = "00000000-0000-0000-0000-000000008645";
const STATE: &str = "00000000-0000-0000-0000-000000008642";
const ROOT_ATTEMPT: &str = "a2000000000000000000000000000001";
const TRANSITION: &str = "b2000000000000000000000000000001";
const DECISION: &str = "c2000000000000000000000000000001";
const DESTINATION_PROMPT: &str =
    "Review the completed implementation against its acceptance criteria.";

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
        false,
        "Continue the task.",
        Some("quote \"and\\slash\""),
        "codex",
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
    let material = launch_material::Entity::find()
        .one(&database)
        .await
        .unwrap()
        .unwrap();
    let prompt = material.prompt.unwrap();
    assert!(prompt.starts_with(
        "Selected workflow prompt:\nContinue the task.\n\nStage skills:\nUse these skills for this stage: [\"quote \\\"and\\\\slash\\\"\"]\n\nWork item context (factual):"
    ));
    assert_eq!(prompt.matches("Stage skills:").count(), 1);
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
        false,
        "Continue the task.",
        None,
        "codex",
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
        false,
        "Continue the task.",
        None,
        "codex",
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

#[tokio::test]
async fn a_handoff_delivers_the_complete_composed_destination_prompt_once() {
    let harness = TerminalLifecycleHarness::start().await;
    let input = harness.data_directory().join("handoff-input.log");
    harness.tmux.create_hosted(
        TASK_RUN_ID,
        &format!(
            "printf '❯ '; while IFS= read -r line; do printf '%s\\n' \"$line\" >> '{}'; printf '❯ '; done",
            input.display()
        ),
    );
    harness.tmux.set_session_option(
        TASK_RUN_ID,
        "@pt-runtime-namespace",
        &harness.runtime_namespace,
    );
    let database = harness.database().await;
    database
        .execute_unprepared(&format!(
            "UPDATE agent_terminal_sessions SET agent = 'claude' WHERE agent_run_id = '{TASK_RUN_ID}'; \
             UPDATE agent_runs SET agent = 'claude' WHERE id = '{TASK_RUN_ID}';"
        ))
        .await
        .unwrap();
    seed_attempt(&database).await;
    let runtime = Arc::new(ScriptedRuntime::default());
    let launch = TerminalLaunchService::new(database.clone(), runtime.clone());
    let cleanup = TerminalCleanupService::new(database.clone(), runtime.clone());
    let agent_runs_before = agent_run::Entity::find()
        .all(&database)
        .await
        .unwrap()
        .len();
    let sessions_before = session::Entity::find().all(&database).await.unwrap().len();
    let decision = recorded_decision(
        &database,
        CallerScope::AutoStart,
        TRANSITION,
        DECISION,
        harness.data_directory(),
        true,
        DESTINATION_PROMPT,
        Some("tdd"),
        "claude",
    )
    .await;

    let continued =
        ticketry_agent_execution::launch_delivery::execute(&database, &launch, &cleanup, &decision)
            .await
            .unwrap();

    let delivered = std::fs::read_to_string(input).unwrap();
    assert_eq!(continued.agent_run_id, TASK_RUN_ID);
    assert_eq!(
        delivered.matches(DESTINATION_PROMPT).count(),
        1,
        "{delivered}"
    );
    assert_eq!(delivered.matches("Stage skills:").count(), 1, "{delivered}");
    assert!(
        delivered.contains("Use these skills for this stage: [\"tdd\"]"),
        "{delivered}"
    );
    assert!(!delivered.contains("/tdd"), "{delivered}");
    assert!(!delivered.contains("$tdd"), "{delivered}");
    assert!(
        delivered.contains("Work item context (factual):"),
        "{delivered}"
    );
    assert_eq!(
        agent_run::Entity::find()
            .all(&database)
            .await
            .unwrap()
            .len(),
        agent_runs_before
    );
    assert_eq!(
        session::Entity::find().all(&database).await.unwrap().len(),
        sessions_before
    );
    assert!(runtime.events().is_empty());
}

#[tokio::test]
async fn legacy_pending_handoffs_preserve_the_selected_skill_through_reconciliation_once() {
    const CASES: [(&str, &str, &str, &str); 3] = [
        (
            "a2000000000000000000000000000011",
            "b2000000000000000000000000000011",
            "c2000000000000000000000000000011",
            "Legacy singleton destination.",
        ),
        (
            "a2000000000000000000000000000012",
            "b2000000000000000000000000000012",
            "c2000000000000000000000000000012",
            "Legacy null destination.",
        ),
        (
            "a2000000000000000000000000000013",
            "b2000000000000000000000000000013",
            "c2000000000000000000000000000013",
            "Legacy blank destination.",
        ),
    ];

    let harness = TerminalLifecycleHarness::start().await;
    let input = harness.data_directory().join("legacy-handoff-input.log");
    let database = harness.database().await;
    database
        .execute_unprepared(&format!(
            "UPDATE agent_terminal_sessions SET agent = 'claude' WHERE agent_run_id = '{TASK_RUN_ID}'; \
             UPDATE agent_runs SET agent = 'claude' WHERE id = '{TASK_RUN_ID}';"
        ))
        .await
        .unwrap();

    for (index, (attempt_id, transition_id, decision_id, prompt)) in CASES.iter().enumerate() {
        seed_attempt_with_identity(&database, attempt_id, transition_id).await;
        let entry_skill = match index {
            0 => serde_json::json!("tdd"),
            1 => serde_json::Value::Null,
            _ => serde_json::json!("   "),
        };
        insert_legacy_pending_handoff(
            &database,
            transition_id,
            decision_id,
            prompt,
            entry_skill,
            harness.data_directory(),
        )
        .await;
    }

    ticketry_installation::install_final_schema_migrations(&database)
        .await
        .expect("upgrade the database containing pending version-2 decisions");
    let migrated = launch_policy::pending(&database, 10).await.unwrap();
    assert_eq!(migrated.len(), 3);
    assert_eq!(migrated[0].stage_skills, ["tdd"]);
    assert!(migrated[1].stage_skills.is_empty());
    assert!(migrated[2].stage_skills.is_empty());

    harness.tmux.create_hosted(
        TASK_RUN_ID,
        &format!(
            "printf '❯ '; while IFS= read -r line; do printf '%s\\n' \"$line\" >> '{}'; printf '❯ '; done",
            input.display()
        ),
    );
    harness.tmux.set_session_option(
        TASK_RUN_ID,
        "@pt-runtime-namespace",
        &harness.runtime_namespace,
    );

    let runtime = Arc::new(ScriptedRuntime::default());
    let reconciliation = ExecutionReconciliationService::with_cleanup(
        database.clone(),
        LaunchPolicyResolver::new(database.clone()),
        TerminalLaunchService::new(database.clone(), runtime.clone()),
        TerminalCleanupService::new(database.clone(), runtime.clone()),
    );
    let first = reconciliation.reconcile_automation(10).await;
    assert!(
        first.automation_failures.is_empty(),
        "legacy handoffs failed: {:?}",
        first.automation_failures
    );
    assert_eq!(first.automation_decisions, 3);
    assert_eq!(
        reconciliation
            .reconcile_automation(10)
            .await
            .automation_decisions,
        0
    );

    let delivered = std::fs::read_to_string(input).unwrap();
    for (_, _, _, prompt) in CASES {
        assert_eq!(delivered.matches(prompt).count(), 1, "{delivered}");
    }
    assert_eq!(delivered.matches("Stage skills:").count(), 1, "{delivered}");
    assert_eq!(
        delivered
            .matches("Use these skills for this stage: [\"tdd\"]")
            .count(),
        1,
        "{delivered}"
    );
    assert!(!delivered.contains("/tdd"), "{delivered}");
    assert!(!delivered.contains("$tdd"), "{delivered}");

    for (attempt_id, _, decision_id, _) in CASES {
        let attempt = automation_attempt::Entity::find_by_id(attempt_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(attempt.status, "succeeded");
        assert_eq!(attempt.delivery_mode.as_deref(), Some("continued"));
        assert_eq!(attempt.agent_run_id.as_deref(), Some(TASK_RUN_ID));
        assert!(launch_policy_decision::Entity::find_by_id(decision_id)
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .delivered_at
            .is_some());
    }
    assert!(runtime.events().is_empty());
}

async fn insert_legacy_pending_handoff(
    database: &sea_orm::DatabaseConnection,
    transition_id: &str,
    decision_id: &str,
    prompt: &str,
    entry_skill: serde_json::Value,
    directory: &std::path::Path,
) {
    let decision_json = serde_json::json!({
        "version": 2,
        "decision_id": decision_id,
        "policy_identity": "binding:legacy-replacement-test",
        "policy_version": 1,
        "caller_scope": "auto_start",
        "idempotency_key": transition_id,
        "handoff": true,
        "task_id": TASK_ID,
        "project_id": PROJECT_ID,
        "issue_type_id": ISSUE_TYPE,
        "state_id": STATE,
        "state_name": "Todo",
        "prompt": prompt,
        "required_skills": ["required-but-not-selected"],
        "entry_skill": entry_skill,
        "provider": "claude",
        "profile": null,
        "model": null,
        "reasoning": null,
        "module_link": {
            "module_id": MODULE_ID,
            "path": directory.display().to_string(),
        },
    });
    launch_policy_decision::Entity::insert(launch_policy_decision::ActiveModel {
        decision_id: Set(decision_id.to_owned()),
        version: Set(2),
        caller_scope: Set("auto_start".to_owned()),
        idempotency_key: Set(transition_id.to_owned()),
        decision_json: Set(decision_json.to_string()),
        created_at: NotSet,
        delivered_at: Set(None),
    })
    .exec_without_returning(database)
    .await
    .unwrap();
}

async fn seed_attempt_with_identity(
    database: &sea_orm::DatabaseConnection,
    attempt_id: &str,
    transition_id: &str,
) {
    database
        .execute_unprepared(&format!(
            "INSERT INTO automation_attempts (\
                id,transition_id,issue_id,from_state_id,to_state_id,workflow_revision,\
                status,retryable,created_at,updated_at\
             ) VALUES (\
                '{attempt_id}','{transition_id}','{}','{}','{}',0,\
                'pending',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\
             )",
            compact(TASK_ID),
            compact(STATE),
            compact(STATE),
        ))
        .await
        .unwrap();
}

async fn recorded_decision(
    database: &sea_orm::DatabaseConnection,
    caller_scope: CallerScope,
    idempotency_key: &str,
    decision_id: &str,
    directory: &std::path::Path,
    handoff: bool,
    prompt: &str,
    stage_skill: Option<&str>,
    provider: &str,
) -> LaunchPolicyDecision {
    launch_policy::record(
        database,
        &LaunchPolicyDecision {
            version: 3,
            decision_id: decision_id.to_owned(),
            policy_identity: "binding:replacement-test".to_owned(),
            policy_version: 1,
            caller_scope,
            idempotency_key: idempotency_key.to_owned(),
            handoff,
            task_id: TASK_ID.to_owned(),
            project_id: PROJECT_ID.to_owned(),
            issue_type_id: ISSUE_TYPE.to_owned(),
            state_id: STATE.to_owned(),
            state_name: Some("Todo".to_owned()),
            prompt: prompt.to_owned(),
            required_skills: Vec::new(),
            stage_skills: stage_skill.into_iter().map(str::to_owned).collect(),
            provider: provider.to_owned(),
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
