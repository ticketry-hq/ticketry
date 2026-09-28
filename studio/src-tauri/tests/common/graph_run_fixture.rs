//! Seeded root, children, status binding, and evidence reads shared by the
//! Graph Run integration tests.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use ticketry_agent_execution::GraphRunService;
use ticketry_entities::launch_material;
use ticketry_launch::TerminalLaunchError;
use ticketry_terminal::{
    TerminalLaunchBoundary, TerminalLaunchCheckpoint, TerminalLaunchRuntime, TerminalLaunchService,
    TerminalRuntimeObservation, VerifiedTerminalRuntime,
};
use ticketry_work_management::launch_policy::LaunchPolicyResolver;

use super::submitted_launch_authority::launch_service;
use super::terminal_lifecycle_harness::{MODULE_ID, PROJECT_ID, TASK_ID};

pub const CHILD_A: &str = "00000000000000000000000000008951";
pub const CHILD_B: &str = "00000000000000000000000000008952";
pub const BLOCKED: &str = "00000000000000000000000000008953";
pub const READY: &str = "00000000000000000000000000008954";
pub const EXTERNAL: &str = "00000000000000000000000000008955";
pub const REVIEW: &str = "00000000000000000000000000008956";
pub const PROVIDER: &str = "00000000000000000000000000008957";
pub const MODEL: &str = "00000000000000000000000000008958";
pub const INVALID_ROOT: &str = "00000000000000000000000000000001";

#[derive(Default)]
pub struct Runtime {
    pub created: Mutex<HashSet<String>>,
}

#[async_trait]
impl TerminalLaunchRuntime for Runtime {
    async fn observe(&self, agent_run_id: &str) -> TerminalRuntimeObservation {
        if self.created.lock().unwrap().contains(agent_run_id) {
            TerminalRuntimeObservation::Running(VerifiedTerminalRuntime {
                tmux_session_name: format!("graph-{agent_run_id}"),
                runtime_namespace: "graph-run-test".to_owned(),
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
            .await?;
        Ok(())
    }
}

pub fn service(database: &DatabaseConnection) -> GraphRunService {
    let policy = LaunchPolicyResolver::new(database.clone());
    let terminal = launch_service(database.clone(), Arc::new(Runtime::default()));
    GraphRunService::new(database.clone(), policy, terminal)
}

pub fn service_with_terminal(
    database: &DatabaseConnection,
    terminal: TerminalLaunchService,
) -> GraphRunService {
    let policy = LaunchPolicyResolver::new(database.clone());
    GraphRunService::new(database.clone(), policy, terminal)
}

pub async fn seed(database: &DatabaseConnection, directory: &std::path::Path) {
    let compact_project = compact(PROJECT_ID);
    let compact_module = compact(MODULE_ID);
    let compact_root = compact(TASK_ID);
    database
        .execute_unprepared(&format!(
            r#"
            INSERT INTO worktracker_state
                (id,project_id,name,"group",color,sort_order,is_protected,created_at,updated_at)
                VALUES ('{REVIEW}','{compact_project}','Review','started','',99,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{CHILD_A}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Child A',9001,0,'a','<p>Child A launch details.</p>',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{CHILD_B}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Child B',9002,0,'b','<p>Child B launch details.</p>',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{BLOCKED}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Blocked',9003,0,'c','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{READY}',project_id,'task',issue_type_id,'{compact_root}','{compact_module}',state_id,0,'Ready',9004,0,'d','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT INTO worktracker_issue
                (id,project_id,type,issue_type_id,parent_id,module_id,state_id,state_revision,name,sequence_id,is_archived,rank,description,created_at,updated_at)
                SELECT '{EXTERNAL}',project_id,'task',issue_type_id,'{compact_module}','{compact_module}',state_id,0,'External',9005,0,'e','',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM worktracker_issue WHERE id='{compact_root}';
            INSERT OR IGNORE INTO worktracker_provider(id,slug,activated,supports_unattended)
                VALUES ('{PROVIDER}','codex',1,1);
            INSERT OR IGNORE INTO worktracker_agentmodel(id,provider_id,name)
                SELECT '{MODEL}',id,'graph-run-test-model' FROM worktracker_provider WHERE slug='codex' LIMIT 1;
            DELETE FROM worktracker_launchbinding WHERE issue_type_id=(SELECT issue_type_id FROM worktracker_issue WHERE id='{compact_root}');
            INSERT INTO worktracker_launchbinding
                (issue_type_id,state_id,prompt,required_skills,model_id,reasoning_id,auto_start,subtree_run_enabled,created_at,updated_at)
                SELECT issue_type_id,state_id,'Initial policy.','[]','{MODEL}',NULL,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
                FROM worktracker_issue WHERE id='{compact_root}';
            INSERT OR REPLACE INTO app_settings(scope,"key",value,updated_at)
                VALUES ('host','provider_catalog','{{"global_default":{{"provider":"codex","model":"graph-run-test-model","reasoning":null}}}}',CURRENT_TIMESTAMP);
            "#
        ))
        .await
        .unwrap();
    std::fs::write(
        directory.join("profiles.json"),
        r#"{"recent_profile_index":0,"profiles":[{"name":"Local","workspace_slug":"terminal-harness"}]}"#,
    )
    .unwrap();
    // The folder a graph run launches in is the Module's typed link. The
    // profile above still decides which workspace may launch at all.
    ticketry_work_management::schema::install(database)
        .await
        .unwrap();
    ticketry_work_management::ModuleLinkStore::new(database.clone())
        .set(&compact_module, &directory.display().to_string())
        .await
        .expect("link the harness module");
}

pub fn task_ids(result: &ticketry_agent_execution::GraphRunResult) -> Vec<&str> {
    result
        .launched
        .iter()
        .map(|row| row.task_id.as_str())
        .collect()
}

pub async fn claim_runs(
    database: &DatabaseConnection,
) -> std::collections::HashMap<String, String> {
    database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT task_id, agent_run_id FROM launched_tasks ORDER BY task_id".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "task_id").unwrap(),
                row.try_get("", "agent_run_id").unwrap(),
            )
        })
        .collect()
}

pub async fn launch_prompt(database: &DatabaseConnection, task_id: &str) -> String {
    database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT prompt FROM terminal_launch_material WHERE task_id='{task_id}' ORDER BY created_at DESC LIMIT 1"
            ),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get("", "prompt")
        .unwrap()
}

pub async fn claim_tuple(
    database: &DatabaseConnection,
    child_id: &str,
) -> (String, String, String, i64) {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT claim_id, agent_run_id, launch_effect_id, launch_generation FROM launched_tasks WHERE task_id='{child_id}'"),
        ))
        .await
        .unwrap()
        .unwrap();
    (
        row.try_get("", "claim_id").unwrap(),
        row.try_get("", "agent_run_id").unwrap(),
        row.try_get("", "launch_effect_id").unwrap(),
        row.try_get("", "launch_generation").unwrap(),
    )
}

pub async fn scalar(database: &DatabaseConnection, sql: &str) -> i64 {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, sql.to_owned()))
        .await
        .unwrap()
        .unwrap()
        .try_get_by_index(0)
        .unwrap()
}

pub async fn scalar_where(
    database: &DatabaseConnection,
    table: &str,
    column: &str,
    value: &str,
) -> i64 {
    scalar(
        database,
        &format!("SELECT COUNT(*) FROM {table} WHERE {column}='{value}'"),
    )
    .await
}

pub fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value).unwrap().simple().to_string()
}

/// The newest launch material a child was prepared with, joined to its Agent
/// Run's recorded launch selection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedLaunch {
    pub effect_id: String,
    pub request_id: String,
    pub agent_run_id: String,
    pub provider: Option<String>,
    pub profile: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub required_skills: String,
    pub prompt: String,
    pub run_agent: Option<String>,
    pub run_model: Option<String>,
    pub run_reasoning: Option<String>,
}

pub async fn prepared_launch(database: &DatabaseConnection, task_id: &str) -> PreparedLaunch {
    let row = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT m.effect_id, m.request_id, m.agent_run_id, m.provider, m.profile, m.model, \
                        m.reasoning, CAST(m.required_skills AS TEXT) AS required_skills, m.prompt, \
                        r.agent, r.launch_model, r.launch_reasoning \
                 FROM terminal_launch_material m JOIN agent_runs r ON r.id = m.agent_run_id \
                 WHERE m.task_id='{task_id}' ORDER BY m.created_at DESC LIMIT 1"
            ),
        ))
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("no launch material for {task_id}"));
    PreparedLaunch {
        effect_id: row.try_get("", "effect_id").unwrap(),
        request_id: row.try_get("", "request_id").unwrap(),
        agent_run_id: row.try_get("", "agent_run_id").unwrap(),
        provider: row.try_get("", "provider").unwrap(),
        profile: row.try_get("", "profile").unwrap(),
        model: row.try_get("", "model").unwrap(),
        reasoning: row.try_get("", "reasoning").unwrap(),
        required_skills: row.try_get("", "required_skills").unwrap(),
        prompt: row.try_get("", "prompt").unwrap(),
        run_agent: row.try_get("", "agent").unwrap(),
        run_model: row.try_get("", "launch_model").unwrap(),
        run_reasoning: row.try_get("", "launch_reasoning").unwrap(),
    }
}
