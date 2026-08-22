use std::sync::Arc;

use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
};
use serde_json::json;

use crate::entities::{runs::agent_run, terminals::session};
use crate::runs_persistence::RunsServices;

use super::{
    checkpoint::NoCleanupCheckpoints, CleanupCause, CleanupCheckpoint, CleanupCheckpoints,
    CleanupEffectIdentity, CleanupKillResult, CleanupRuntimeObservation, TerminalCleanupError,
    TerminalCleanupErrorCode, TerminalCleanupRuntime, TmuxCleanupRuntime,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedAgentRun {
    pub agent_run_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub scope: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminationPatch {
    Omitted,
    Null,
    Request(String),
}

#[derive(Clone)]
pub struct TerminalCleanupService {
    pub(super) database: DatabaseConnection,
    pub(super) runs: RunsServices,
    pub(super) runtime: Arc<dyn TerminalCleanupRuntime>,
    pub(super) checkpoints: Arc<dyn CleanupCheckpoints>,
    pub(super) lease_owner: String,
}

const RECOVERY_BATCH: u64 = 200;
pub const DEFAULT_OWNED_ORPHAN_GRACE_SECONDS: i64 = 30;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TerminalCleanupRecoveryReport {
    pub applied: usize,
    pub deferred: usize,
    pub conflicted: usize,
}

impl TerminalCleanupService {
    pub fn new(database: DatabaseConnection, runtime: Arc<dyn TerminalCleanupRuntime>) -> Self {
        Self {
            runs: RunsServices::new(database.clone()),
            database,
            runtime,
            checkpoints: Arc::new(NoCleanupCheckpoints),
            lease_owner: uuid::Uuid::new_v4().simple().to_string(),
        }
    }

    pub fn with_tmux(database: DatabaseConnection) -> Self {
        Self::new(database, Arc::new(TmuxCleanupRuntime))
    }

    pub fn with_checkpoints(mut self, checkpoints: Arc<dyn CleanupCheckpoints>) -> Self {
        self.checkpoints = checkpoints;
        self
    }

    pub(crate) fn database(&self) -> &DatabaseConnection {
        &self.database
    }

    pub async fn update_terminal_session(
        &self,
        agent_run_id: &str,
        termination: TerminationPatch,
    ) -> Result<session::Model, TerminalCleanupError> {
        match termination {
            TerminationPatch::Omitted => self.authoritative(agent_run_id).await,
            TerminationPatch::Null => Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::InvalidRequest,
                "A termination request cannot be null.",
            )),
            TerminationPatch::Request(request_id) => {
                self.cleanup(agent_run_id, CleanupCause::Explicit, &request_id)
                    .await
            }
        }
    }

    pub async fn terminate_current_run(
        &self,
        principal: &AuthenticatedAgentRun,
        request_id: &str,
    ) -> Result<session::Model, TerminalCleanupError> {
        let run = agent_run::Entity::find_by_id(&principal.agent_run_id)
            .one(&self.database)
            .await?
            .ok_or_else(not_found)?;
        let terminal = self.authoritative(&principal.agent_run_id).await?;
        if !same_id(&run.issue_id, &principal.issue_id)
            || !same_id(&terminal.project_id, &principal.project_id)
            || terminal.scope != principal.scope
        {
            return Err(TerminalCleanupError::new(
                TerminalCleanupErrorCode::InvalidRequest,
                "The authenticated Agent Run scope does not match the Terminal Session.",
            ));
        }
        self.cleanup(&principal.agent_run_id, CleanupCause::Explicit, request_id)
            .await
    }

    /// Execute one cause-bound cleanup. Launch compensation, hosted exit,
    /// orphan quarantine, and temporary-profile teardown use this same seam.
    pub async fn cleanup(
        &self,
        agent_run_id: &str,
        cause: CleanupCause,
        cause_identity: &str,
    ) -> Result<session::Model, TerminalCleanupError> {
        let terminal = self.authoritative(agent_run_id).await?;
        if terminal.terminated_at.is_some() && !terminal.runtime_cleanup_pending {
            return Ok(terminal);
        }
        let identity = CleanupEffectIdentity::predetermined(agent_run_id, cause, cause_identity)?;
        let effect = self.prepare(&identity).await?;
        self.checkpoints.reached(CleanupCheckpoint::Preparation)?;
        self.execute_effect(effect, terminal).await
    }

    /// Drain cleanup effects that a prior process left prepared, pending, or
    /// behind an expired lease. The original effect identity remains the only
    /// authority; recovery never manufactures a replacement request.
    pub async fn reconcile(&self) -> Result<TerminalCleanupRecoveryReport, TerminalCleanupError> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
        let due = crate::entities::terminals::cleanup_effect::Entity::find()
            .filter(
                Condition::any()
                    .add(crate::entities::terminals::cleanup_effect::Column::State.eq("prepared"))
                    .add(
                        crate::entities::terminals::cleanup_effect::Column::State
                            .eq("cleanup_pending"),
                    )
                    .add(
                        Condition::all()
                            .add(
                                crate::entities::terminals::cleanup_effect::Column::State
                                    .eq("leased"),
                            )
                            .add(
                                crate::entities::terminals::cleanup_effect::Column::LeaseExpiresAt
                                    .lt(now),
                            ),
                    ),
            )
            .order_by_asc(crate::entities::terminals::cleanup_effect::Column::CreatedAt)
            .order_by_asc(crate::entities::terminals::cleanup_effect::Column::EffectId)
            .limit(RECOVERY_BATCH)
            .all(&self.database)
            .await?;
        let mut report = TerminalCleanupRecoveryReport::default();
        for effect in due {
            if effect.cause == "owned_orphan" && orphan_grace_active(&effect.created_at) {
                report.deferred += 1;
                continue;
            }
            let terminal = self.authoritative(&effect.agent_run_id).await?;
            match self.execute_effect(effect, terminal).await {
                Ok(_) => report.applied += 1,
                Err(error) => match error.code() {
                    TerminalCleanupErrorCode::CleanupPending
                    | TerminalCleanupErrorCode::EffectBusy => report.deferred += 1,
                    TerminalCleanupErrorCode::RuntimeIdentityConflict
                    | TerminalCleanupErrorCode::Conflict => report.conflicted += 1,
                    _ => return Err(error),
                },
            }
        }
        Ok(report)
    }

    async fn execute_effect(
        &self,
        effect: crate::entities::terminals::cleanup_effect::Model,
        terminal: session::Model,
    ) -> Result<session::Model, TerminalCleanupError> {
        if effect.state == "applied" {
            return Ok(terminal);
        }
        let claim = self.claim(&effect.effect_id).await?;
        self.checkpoints.reached(CleanupCheckpoint::Claim)?;
        let observation = self.runtime.inspect(&terminal).await;
        self.checkpoints.reached(CleanupCheckpoint::Inspect)?;
        match observation {
            CleanupRuntimeObservation::Missing => {
                self.settle_applied(&claim, &terminal, json!({"observation": "missing"}))
                    .await
            }
            CleanupRuntimeObservation::Foreign | CleanupRuntimeObservation::Ambiguous => {
                self.settle_conflict(&claim, observation).await?;
                Err(TerminalCleanupError::new(
                    TerminalCleanupErrorCode::RuntimeIdentityConflict,
                    "Terminal cleanup refused an unverified runtime identity.",
                ))
            }
            CleanupRuntimeObservation::Unavailable => {
                self.settle_pending(
                    &claim,
                    "terminal_runtime_unavailable",
                    "Runtime inspection is unavailable.",
                    json!({"observation": "unavailable"}),
                )
                .await?;
                Err(TerminalCleanupError::new(
                    TerminalCleanupErrorCode::CleanupPending,
                    "Terminal cleanup is pending verified runtime inspection.",
                ))
            }
            CleanupRuntimeObservation::Running | CleanupRuntimeObservation::Exited { .. } => {
                let kill = self.runtime.kill_verified(&terminal).await;
                self.checkpoints.reached(CleanupCheckpoint::Kill)?;
                match kill {
                    CleanupKillResult::Foreign | CleanupKillResult::Ambiguous => {
                        self.settle_conflict(&claim, observation).await?;
                        Err(TerminalCleanupError::new(
                            TerminalCleanupErrorCode::RuntimeIdentityConflict,
                            "Terminal cleanup refused an unverified runtime identity.",
                        ))
                    }
                    CleanupKillResult::Unconfirmed => {
                        self.settle_pending(&claim, "terminal_kill_unconfirmed", "Runtime termination was not confirmed.", json!({"observation": observation_name(observation), "kill": "unconfirmed"})).await?;
                        Err(TerminalCleanupError::new(
                            TerminalCleanupErrorCode::CleanupPending,
                            "Terminal cleanup is pending runtime confirmation.",
                        ))
                    }
                    CleanupKillResult::Killed | CleanupKillResult::AlreadyMissing => {
                        match self.runtime.inspect(&terminal).await {
                            CleanupRuntimeObservation::Missing => self.settle_applied(
                                &claim,
                                &terminal,
                                json!({"observation": observation_name(observation), "kill": kill_name(kill), "confirmedAbsent": true}),
                            ).await,
                            conflict @ (CleanupRuntimeObservation::Foreign
                            | CleanupRuntimeObservation::Ambiguous) => {
                                self.settle_conflict(&claim, conflict).await?;
                                Err(TerminalCleanupError::new(
                                    TerminalCleanupErrorCode::RuntimeIdentityConflict,
                                    "Terminal cleanup found conflicting runtime identity after termination.",
                                ))
                            }
                            _ => {
                                self.settle_pending(&claim, "terminal_absence_unconfirmed", "Runtime absence was not confirmed.", json!({"observation": observation_name(observation), "kill": kill_name(kill), "confirmedAbsent": false})).await?;
                                Err(TerminalCleanupError::new(
                                    TerminalCleanupErrorCode::CleanupPending,
                                    "Terminal cleanup is pending absence confirmation.",
                                ))
                            }
                        }
                    }
                }
            }
        }
    }
}

fn orphan_grace_active(created_at: &str) -> bool {
    let configured = std::env::var("TICKETRY_OWNED_ORPHAN_GRACE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .unwrap_or(DEFAULT_OWNED_ORPHAN_GRACE_SECONDS);
    chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|created| {
            created.with_timezone(&chrono::Utc) + chrono::Duration::seconds(configured)
                > chrono::Utc::now()
        })
        .unwrap_or(true)
}
fn same_id(left: &str, right: &str) -> bool {
    left.replace('-', "")
        .eq_ignore_ascii_case(&right.replace('-', ""))
}
pub(super) fn not_found() -> TerminalCleanupError {
    TerminalCleanupError::new(
        TerminalCleanupErrorCode::NotFound,
        "The Terminal Session does not exist.",
    )
}
pub(super) fn observation_name(value: CleanupRuntimeObservation) -> &'static str {
    match value {
        CleanupRuntimeObservation::Running => "running",
        CleanupRuntimeObservation::Exited { .. } => "exited",
        CleanupRuntimeObservation::Missing => "missing",
        CleanupRuntimeObservation::Foreign => "foreign",
        CleanupRuntimeObservation::Ambiguous => "ambiguous",
        CleanupRuntimeObservation::Unavailable => "unavailable",
    }
}
fn kill_name(value: CleanupKillResult) -> &'static str {
    match value {
        CleanupKillResult::Killed => "killed",
        CleanupKillResult::AlreadyMissing => "already_missing",
        _ => "unconfirmed",
    }
}
