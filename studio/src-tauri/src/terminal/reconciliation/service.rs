use std::sync::Arc;

use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait,
};
use serde_json::json;

use crate::terminal::cleanup::{
    CleanupCause, CleanupRuntimeObservation, TerminalCleanupRuntime, TerminalCleanupService,
};
use crate::terminal::launch::{TerminalLaunchRuntime, TerminalLaunchService};
use ticketry_entities::{runs::agent_run, terminals::session};
use ticketry_runs::persistence::{NewStatusEvent, RunsServices, TerminalFact, TerminalOutcome};

use super::batch::{recorded_session_batch, RecordedSessionCursors};
use super::{
    NoReconciliationCheckpoints, ReconciledSession, ReconciliationCheckpoint,
    ReconciliationCheckpoints, RecordedSessionDecision, TerminalReconciliationError,
    TerminalReconciliationReport,
};

#[derive(Clone)]
pub struct TerminalReconciliationService {
    pub(super) database: DatabaseConnection,
    runs: RunsServices,
    launch: TerminalLaunchService,
    cleanup: TerminalCleanupService,
    pub(super) runtime: Arc<dyn TerminalCleanupRuntime>,
    pub(super) checkpoints: Arc<dyn ReconciliationCheckpoints>,
    cursors: Arc<RecordedSessionCursors>,
}

impl TerminalReconciliationService {
    pub fn new(
        database: DatabaseConnection,
        launch_runtime: Arc<dyn TerminalLaunchRuntime>,
        cleanup_runtime: Arc<dyn TerminalCleanupRuntime>,
    ) -> Self {
        Self {
            runs: RunsServices::new(database.clone()),
            launch: TerminalLaunchService::new(database.clone(), launch_runtime),
            cleanup: TerminalCleanupService::new(database.clone(), cleanup_runtime.clone()),
            database,
            runtime: cleanup_runtime,
            checkpoints: Arc::new(NoReconciliationCheckpoints),
            cursors: Arc::new(RecordedSessionCursors::default()),
        }
    }

    pub fn with_checkpoints(mut self, checkpoints: Arc<dyn ReconciliationCheckpoints>) -> Self {
        self.checkpoints = checkpoints;
        self
    }

    /// Reconcile effects before rows. A launch adopted in this pass is then
    /// checked as a recorded session, while a cleanup settled in this pass is
    /// already a stable tombstone when the row scan reaches it. The row scan is
    /// a bounded batch that prefers rows whose durable state can still change
    /// and advances a cursor, so a saturated pass reports saturation and the
    /// next pass continues past the rows it already inspected.
    pub async fn reconcile(
        &self,
    ) -> Result<TerminalReconciliationReport, TerminalReconciliationError> {
        let launches = self.launch.reconcile().await?;
        let cleanups = self.cleanup.reconcile().await?;
        let recorded = recorded_session_batch(&self.database, &self.cursors).await?;
        let sessions_saturated = recorded.saturated;
        let mut sessions = Vec::with_capacity(recorded.rows.len());
        for terminal in recorded.rows {
            let observation = self.runtime.inspect(&terminal).await;
            self.checkpoints.reached(
                &terminal.agent_run_id,
                ReconciliationCheckpoint::RuntimeObserved,
            )?;
            let decision = self.reconcile_session(&terminal, observation).await?;
            sessions.push(ReconciledSession {
                agent_run_id: terminal.agent_run_id,
                decision,
            });
        }
        let inventory = self.reconcile_inventory().await?;
        Ok(TerminalReconciliationReport {
            launches,
            cleanups,
            sessions,
            sessions_saturated,
            unrecorded: inventory.unrecorded,
            conflicts: inventory.conflicts,
            inventory_unavailable: inventory.unavailable,
        })
    }

    async fn reconcile_session(
        &self,
        terminal: &session::Model,
        observation: CleanupRuntimeObservation,
    ) -> Result<RecordedSessionDecision, TerminalReconciliationError> {
        if terminal.terminated_at.is_some() {
            return match observation {
                CleanupRuntimeObservation::Running if !terminal.runtime_cleanup_pending => {
                    self.repair_tombstone(terminal).await?;
                    Ok(RecordedSessionDecision::Recovered)
                }
                CleanupRuntimeObservation::Unavailable => Ok(RecordedSessionDecision::Unavailable),
                CleanupRuntimeObservation::Foreign | CleanupRuntimeObservation::Ambiguous => {
                    Ok(RecordedSessionDecision::Conflict)
                }
                _ => Ok(RecordedSessionDecision::Unchanged),
            };
        }
        match observation {
            CleanupRuntimeObservation::Running => Ok(RecordedSessionDecision::Running),
            CleanupRuntimeObservation::Exited { exit_code } => {
                self.record_terminal_outcome(terminal, TerminalOutcome::Exited, exit_code, true)
                    .await?;
                let cleanup = self
                    .cleanup
                    .cleanup(
                        &terminal.agent_run_id,
                        CleanupCause::HostedExit,
                        &terminal.agent_run_id,
                    )
                    .await;
                self.checkpoints.reached(
                    &terminal.agent_run_id,
                    ReconciliationCheckpoint::CleanupScheduled,
                )?;
                if let Err(error) = cleanup {
                    if !matches!(
                        error.code(),
                        crate::terminal::cleanup::TerminalCleanupErrorCode::CleanupPending
                            | crate::terminal::cleanup::TerminalCleanupErrorCode::EffectBusy
                    ) {
                        return Err(error.into());
                    }
                }
                Ok(RecordedSessionDecision::Exited)
            }
            CleanupRuntimeObservation::Missing => {
                self.record_terminal_outcome(terminal, TerminalOutcome::Lost, None, false)
                    .await?;
                Ok(RecordedSessionDecision::Lost)
            }
            CleanupRuntimeObservation::Unavailable => Ok(RecordedSessionDecision::Unavailable),
            CleanupRuntimeObservation::Foreign | CleanupRuntimeObservation::Ambiguous => {
                Ok(RecordedSessionDecision::Conflict)
            }
        }
    }

    async fn record_terminal_outcome(
        &self,
        terminal: &session::Model,
        outcome: TerminalOutcome,
        exit_code: Option<i32>,
        cleanup_pending: bool,
    ) -> Result<(), TerminalReconciliationError> {
        let transaction = self.database.begin().await?;
        let occurred_at = Utc::now().to_rfc3339();
        session::Entity::update_many()
            .col_expr(
                session::Column::TerminatedAt,
                Expr::value(Some(occurred_at.clone())),
            )
            .col_expr(
                session::Column::RuntimeCleanupPending,
                Expr::value(cleanup_pending),
            )
            .filter(session::Column::AgentRunId.eq(&terminal.agent_run_id))
            .filter(session::Column::TerminatedAt.is_null())
            .exec(&transaction)
            .await?;
        self.checkpoints.reached(
            &terminal.agent_run_id,
            ReconciliationCheckpoint::TerminalSessionUpdated,
        )?;
        let run_checkpoint = self.checkpoints.clone();
        let status_checkpoint = self.checkpoints.clone();
        let run_id = terminal.agent_run_id.clone();
        let status_run_id = terminal.agent_run_id.clone();
        let acceptance = self
            .runs
            .lifecycle()
            .apply_terminal_fact_in_observed(
                &transaction,
                TerminalFact {
                    agent_run_id: terminal.agent_run_id.clone(),
                    outcome,
                    occurred_at: occurred_at.clone(),
                    exit_code,
                },
                move || {
                    checkpoint(
                        &run_checkpoint,
                        &run_id,
                        ReconciliationCheckpoint::RunFactApplied,
                    )
                },
                move || {
                    checkpoint(
                        &status_checkpoint,
                        &status_run_id,
                        ReconciliationCheckpoint::StatusAppended,
                    )
                },
            )
            .await?;
        if !acceptance.applied {
            self.append_availability_fact(&transaction, terminal, &occurred_at)
                .await?;
            self.checkpoints.reached(
                &terminal.agent_run_id,
                ReconciliationCheckpoint::StatusAppended,
            )?;
        }
        transaction.commit().await?;
        self.runs.lifecycle().events().wake_committed();
        self.checkpoints.reached(
            &terminal.agent_run_id,
            ReconciliationCheckpoint::RepairCommitted,
        )?;
        Ok(())
    }

    async fn repair_tombstone(
        &self,
        terminal: &session::Model,
    ) -> Result<(), TerminalReconciliationError> {
        let transaction = self.database.begin().await?;
        let occurred_at = Utc::now().to_rfc3339();
        session::Entity::update_many()
            .col_expr(session::Column::TerminatedAt, Expr::value(None::<String>))
            .filter(session::Column::AgentRunId.eq(&terminal.agent_run_id))
            .filter(session::Column::TerminatedAt.is_not_null())
            .filter(session::Column::RuntimeCleanupPending.eq(false))
            .exec(&transaction)
            .await?;
        self.checkpoints.reached(
            &terminal.agent_run_id,
            ReconciliationCheckpoint::TerminalSessionUpdated,
        )?;
        self.append_availability_fact(&transaction, terminal, &occurred_at)
            .await?;
        self.checkpoints.reached(
            &terminal.agent_run_id,
            ReconciliationCheckpoint::StatusAppended,
        )?;
        transaction.commit().await?;
        self.runs.lifecycle().events().wake_committed();
        self.checkpoints.reached(
            &terminal.agent_run_id,
            ReconciliationCheckpoint::RepairCommitted,
        )?;
        Ok(())
    }

    async fn append_availability_fact(
        &self,
        transaction: &sea_orm::DatabaseTransaction,
        terminal: &session::Model,
        occurred_at: &str,
    ) -> Result<(), TerminalReconciliationError> {
        let run = agent_run::Entity::find_by_id(&terminal.agent_run_id)
            .one(transaction)
            .await?
            .ok_or_else(|| {
                TerminalReconciliationError::new(
                    super::TerminalReconciliationErrorCode::Storage,
                    "The reconciled Terminal Session has no Agent Run.",
                )
            })?;
        let state = if run.status == "lost" {
            "lost".to_owned()
        } else if run.ended_at.is_some() {
            "exited".to_owned()
        } else {
            run.lifecycle_state
                .clone()
                .unwrap_or_else(|| "starting".to_owned())
        };
        let event_id = uuid::Uuid::new_v4().simple().to_string();
        self.runs
            .lifecycle()
            .events()
            .append(
                transaction,
                NewStatusEvent {
                    event_id: &event_id,
                    project_id: &terminal.project_id,
                    event_kind: "agent_run.terminal",
                    payload_version: 1,
                    subject_kind: "agent_run",
                    subject_id: &terminal.agent_run_id,
                    agent_run_id: Some(&terminal.agent_run_id),
                    automation_attempt_id: None,
                    work_item_id: Some(&run.issue_id),
                    payload: &json!({
                        "agentRunId": terminal.agent_run_id,
                        "state": state,
                        "outcome": run.status,
                        "occurredAt": occurred_at,
                        "exitCode": run.exit_code,
                    }),
                },
            )
            .await?;
        Ok(())
    }
}

fn checkpoint(
    checkpoints: &Arc<dyn ReconciliationCheckpoints>,
    agent_run_id: &str,
    point: ReconciliationCheckpoint,
) -> Result<(), ticketry_runs::persistence::RunsPersistenceError> {
    checkpoints.reached(agent_run_id, point).map_err(|error| {
        ticketry_runs::persistence::RunsPersistenceError::new(
            ticketry_runs::persistence::RunsPersistenceErrorCode::Storage,
            error.to_string(),
        )
    })
}
