mod common;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use common::submitted_launch_authority::launch_service;
use common::terminal_lifecycle_harness::{TerminalLifecycleHarness, MODULE_ID, TASK_ID};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};
use ticketry_agent_execution::{
    reconciliation::ExecutionReconciliationService,
    run_now::{RunNowCaller, RunNowRequest, RunNowService},
};
use ticketry_entities::launch_material;
use ticketry_launch::TerminalLaunchError;
use ticketry_terminal::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchRuntime,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use ticketry_work_management::launch_policy::{
    self, CallerScope, LaunchPolicyRequest, LaunchPolicyResolver,
};

const IMPLEMENT: &str = "00000000000000000000000000008959";
const MODEL: &str = "00000000000000000000000000008958";
const ROOT_ATTEMPT: &str = "a1000000000000000000000000000001";
const RETRY_ATTEMPT: &str = "a1000000000000000000000000000002";
const AUTO_START_TRANSITION: &str = "b1000000000000000000000000000001";

#[derive(Default)]
struct Runtime {
    created: Mutex<HashSet<String>>,
}

#[async_trait]
impl TerminalLaunchRuntime for Runtime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.created.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("prompt-{agent_run_id}"),
                runtime_namespace: "task-prompt-test".to_owned(),
            })
        } else {
            TerminalRuntimeObservation::Missing
        }
    }

    async fn materialize_and_create(
        &self,
        material: &launch_material::Model,
        checkpoint: &dyn TerminalLaunchCheckpoint,
    ) -> Result<(), TerminalLaunchError> {
        self.created
            .lock()
            .unwrap()
            .insert(material.agent_run_id.clone());
        checkpoint
            .checkpoint(TerminalLaunchBoundary::TmuxCreated)
            .await?;
        checkpoint
            .checkpoint(TerminalLaunchBoundary::OwnershipMetadataWritten)
            .await
    }
}

#[tokio::test]
async fn policy_driven_task_launches_include_the_work_item_description() {
    let harness = TerminalLifecycleHarness::start().await;
    let database = harness.database().await;
    seed(&database, harness.data_directory()).await;
    let terminal = launch_service(database.clone(), Arc::new(Runtime::default()));
    let resolver = LaunchPolicyResolver::new(database.clone());

    let run_now = RunNowService::new(database.clone(), resolver.clone(), terminal.clone(), None)
        .execute(RunNowRequest {
            id_or_key: compact(TASK_ID),
            request_identity: "run-now-prompt-regression".to_owned(),
            caller: RunNowCaller::Human,
        })
        .await
        .unwrap();
    assert_complete_prompt(
        launch_material::Entity::find()
            .filter(launch_material::Column::AgentRunId.eq(run_now.run.agent_run_id))
            .one(&database)
            .await
            .unwrap()
            .unwrap()
            .prompt
            .as_deref()
            .unwrap(),
    );

    for (scope, idempotency_key) in [
        (CallerScope::AutoStart, AUTO_START_TRANSITION),
        (CallerScope::Retry, RETRY_ATTEMPT),
    ] {
        let decision = resolver
            .resolve(LaunchPolicyRequest {
                task_id: TASK_ID.to_owned(),
                destination_state_id: None,
                provider_override: None,
                caller_scope: scope,
                idempotency_key: idempotency_key.to_owned(),
                handoff: false,
            })
            .await
            .unwrap();
        launch_policy::record(&database, &decision).await.unwrap();
        let report = ExecutionReconciliationService::new(
            database.clone(),
            resolver.clone(),
            terminal.clone(),
        )
        .reconcile_automation(10)
        .await;
        assert!(
            report.automation_failures.is_empty(),
            "{scope:?} launch failed: {:?}",
            report.automation_failures
        );
        assert_complete_prompt(
            launch_material::Entity::find()
                .filter(launch_material::Column::RequestId.eq(idempotency_key))
                .one(&database)
                .await
                .unwrap()
                .unwrap()
                .prompt
                .as_deref()
                .unwrap(),
        );
    }
}

fn assert_complete_prompt(prompt: &str) {
    assert!(prompt
        .starts_with("Selected workflow prompt:\nInitial policy.\n\nWork item context (factual):"));
    assert!(prompt.contains("Description:\nPolicy launch details."));
}

async fn seed(database: &sea_orm::DatabaseConnection, directory: &std::path::Path) {
    let task = compact(TASK_ID);
    database
        .execute_unprepared(&format!(
            r#"
            UPDATE worktracker_issue
                SET description='<p>Policy launch details.</p>'
                WHERE id='{task}';
            UPDATE agent_runs
                SET status='terminated', ended_at=CURRENT_TIMESTAMP
                WHERE issue_id='{task}';
            UPDATE agent_terminal_sessions
                SET terminated_at=CURRENT_TIMESTAMP
                WHERE task_id='{task}';
            UPDATE worktracker_state
                SET name='Ideas', "group"='backlog'
                WHERE id=(SELECT state_id FROM worktracker_issue WHERE id='{task}');
            INSERT INTO worktracker_state
                (id,project_id,name,"group",color,sort_order,is_protected,created_at,updated_at)
                SELECT '{IMPLEMENT}', project_id, 'Implement', 'started', '', 98, 0,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM worktracker_issue WHERE id='{task}';
            UPDATE worktracker_issuetype
                SET name='Story', workflow_revision=1
                WHERE id=(SELECT issue_type_id FROM worktracker_issue WHERE id='{task}');
            INSERT INTO worktracker_issuetypetransition
                (issue_type_id,from_state_id,to_state_id,agent_allowed)
                SELECT issue_type_id,state_id,'{IMPLEMENT}',1
                FROM worktracker_issue WHERE id='{task}';
            INSERT INTO worktracker_agentmodel(id,provider_id,name)
                SELECT '{MODEL}',id,'prompt-test-model'
                FROM worktracker_provider WHERE slug='codex';
            DELETE FROM worktracker_launchbinding
                WHERE issue_type_id=(SELECT issue_type_id FROM worktracker_issue WHERE id='{task}');
            INSERT INTO worktracker_launchbinding
                (issue_type_id,state_id,prompt,required_skills,model_id,reasoning_id,
                 auto_start,subtree_run_enabled,created_at,updated_at)
                SELECT issue_type_id,'{IMPLEMENT}','Initial policy.','[]','{MODEL}',NULL,
                       1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
                FROM worktracker_issue WHERE id='{task}';
            INSERT OR REPLACE INTO app_settings(scope,"key",value,updated_at)
                VALUES ('host','provider_catalog',
                        '{{"global_default":{{"provider":"codex","model":"prompt-test-model","reasoning":null}}}}',
                        CURRENT_TIMESTAMP);
            INSERT INTO automation_attempts (
                id,transition_id,issue_id,from_state_id,to_state_id,workflow_revision,
                status,retryable,retry_of_id,root_attempt_id,created_at,updated_at
            ) VALUES
                ('{ROOT_ATTEMPT}','{AUTO_START_TRANSITION}','{task}','{IMPLEMENT}','{IMPLEMENT}',
                 1,'pending',1,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
                ('{RETRY_ATTEMPT}','b1000000000000000000000000000002','{task}',
                 '{IMPLEMENT}','{IMPLEMENT}',1,'pending',1,'{ROOT_ATTEMPT}','{ROOT_ATTEMPT}',
                 CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    std::fs::write(
        directory.join("profiles.json"),
        r#"{"recent_profile_index":0,"profiles":[{"name":"Local","workspace_slug":"terminal-harness"}]}"#,
    )
    .unwrap();
    // The folder the prompt names is the Module's typed link. The profile above
    // still decides which workspace may launch at all.
    ticketry_work_management::schema::install(database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(&compact(MODULE_ID), &directory.display().to_string())
        .await
        .expect("link the harness module");
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value).unwrap().simple().to_string()
}
