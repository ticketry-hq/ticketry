use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};

use super::entities::agent_run;
use super::work_item_scope;
use super::{
    LifecycleService, RunsPersistenceError, RunsPersistenceErrorCode, TerminalFact, TerminalOutcome,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedAgentRun {
    pub agent_run_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub scope: String,
}

/// The complete bounded payload allowed to cross into the temporary Python
/// terminal executor. It cannot carry a prompt, path, token, environment, or
/// command line.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminateRunRequest {
    pub agent_run_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminationExecutorEvidence {
    pub was_present: bool,
}

#[async_trait]
pub trait TerminationExecutor: Send + Sync {
    async fn terminate(
        &self,
        request: TerminateRunRequest,
    ) -> Result<TerminationExecutorEvidence, RunsPersistenceError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminationResult {
    pub agent_run_id: String,
    pub terminated: bool,
    pub already_terminated: bool,
    pub durable_fact_applied: bool,
}

#[derive(Clone)]
pub struct RunTerminationService {
    database: DatabaseConnection,
    lifecycle: LifecycleService,
    executor: Arc<dyn TerminationExecutor>,
}

impl RunTerminationService {
    pub fn new(
        database: DatabaseConnection,
        lifecycle: LifecycleService,
        executor: Arc<dyn TerminationExecutor>,
    ) -> Self {
        Self {
            database,
            lifecycle,
            executor,
        }
    }

    /// Terminate only the authenticated run. There is intentionally no target
    /// argument for GraphQL or MCP callers to widen.
    pub async fn terminate_current_run(
        &self,
        principal: &AuthenticatedAgentRun,
    ) -> Result<TerminationResult, RunsPersistenceError> {
        let run = agent_run::Entity::find_by_id(&principal.agent_run_id)
            .one(&self.database)
            .await?
            .ok_or_else(|| {
                RunsPersistenceError::new(
                    RunsPersistenceErrorCode::NotFound,
                    "The authenticated Agent Run does not exist.",
                )
            })?;
        let project_id = work_item_scope::project_id(&self.database, &run.issue_id)
            .await?
            .ok_or_else(|| {
                RunsPersistenceError::new(
                    RunsPersistenceErrorCode::InvalidHistory,
                    "The authenticated Agent Run references no WorkItem.",
                )
            })?;
        if database_uuid(&principal.issue_id) != database_uuid(&run.issue_id)
            || database_uuid(&principal.project_id) != database_uuid(&project_id)
            || principal.scope != run.scope
        {
            return Err(RunsPersistenceError::new(
                RunsPersistenceErrorCode::Unauthorized,
                "The authenticated run scope does not match the requested operation.",
            ));
        }

        self.executor
            .terminate(TerminateRunRequest {
                agent_run_id: principal.agent_run_id.clone(),
            })
            .await
            .map_err(|_| {
                RunsPersistenceError::new(
                    RunsPersistenceErrorCode::ExecutorUnavailable,
                    "The terminal compatibility executor could not terminate the current run.",
                )
            })?;
        let terminal = self
            .lifecycle
            .apply_terminal_fact(TerminalFact {
                agent_run_id: principal.agent_run_id.clone(),
                outcome: TerminalOutcome::Terminated,
                occurred_at: super::timestamp::format(chrono::Utc::now()),
                exit_code: None,
            })
            .await?;
        Ok(TerminationResult {
            agent_run_id: principal.agent_run_id.clone(),
            terminated: true,
            already_terminated: run.ended_at.is_some(),
            durable_fact_applied: terminal.applied,
        })
    }
}

fn database_uuid(value: &str) -> String {
    value.replace('-', "").to_lowercase()
}
