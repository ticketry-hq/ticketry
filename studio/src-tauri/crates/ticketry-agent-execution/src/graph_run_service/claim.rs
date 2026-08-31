use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection,
    DatabaseTransaction, EntityTrait, QueryFilter,
};
use sha2::{Digest, Sha256};

use crate::execution::graph::{
    automatic_candidates, manual_candidates, scheduling_facts, ChildSchedulingFacts, ExecutionMode,
    GraphAccess,
};
use ticketry_entities::{
    execution::{graph_run, launch_claim},
    runs::{agent_run, launch_effect},
    terminals::session,
};
use ticketry_runs::persistence::{
    LaunchIntent, LaunchPreparationParticipant, RunsPersistenceError, RunsPersistenceErrorCode,
};

pub(super) struct CampaignClaim<'a> {
    pub root_id: &'a str,
    pub child_id: &'a str,
    pub policy_snapshot: &'a str,
    pub mode: ExecutionMode,
    pub access: &'a GraphAccess,
    pub identity: ClaimGeneration,
    pub selection: ClaimSelection,
}

#[derive(Clone, Copy)]
pub(super) enum ClaimSelection {
    Automatic,
    Manual,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ClaimGeneration {
    pub claim_id: String,
    pub request_id: String,
    pub generation: i64,
}

impl ClaimGeneration {
    pub(super) async fn next(
        database: &DatabaseConnection,
        root_id: &str,
        child_id: &str,
    ) -> Result<Self, sea_orm::DbErr> {
        let generation = launch_claim::Entity::find_by_id(child_id)
            .one(database)
            .await?
            .filter(|claim| claim.root_id == root_id)
            .map_or(1, |claim| claim.launch_generation.saturating_add(1));
        Ok(Self::new(root_id, child_id, generation))
    }

    fn new(root_id: &str, child_id: &str, generation: i64) -> Self {
        let seed = format!("{root_id}:{child_id}:{generation}");
        Self {
            claim_id: derived("campaign-claim", &seed),
            request_id: format!("campaign:{}", derived("campaign-launch", &seed)),
            generation,
        }
    }
}

#[async_trait]
impl LaunchPreparationParticipant for CampaignClaim<'_> {
    async fn prepare_in(
        &self,
        transaction: &DatabaseTransaction,
        intent: &LaunchIntent,
        reused: bool,
    ) -> Result<(), RunsPersistenceError> {
        validate_intent(self, intent)?;
        let graph = graph_run::Entity::find_by_id(self.root_id)
            .one(transaction)
            .await?
            .filter(|row| row.launch_configuration.as_deref() == Some(self.policy_snapshot))
            .ok_or_else(campaign_changed)?;
        if parse_mode(&graph.execution_mode) != Some(self.mode) {
            return Err(campaign_changed());
        }

        // Runs inserted this generation's predetermined Agent Run before the
        // participant rechecks eligibility. Exclude only that row.
        let facts = scheduling_facts(
            transaction,
            self.root_id,
            self.access,
            Some(&intent.agent_run_id),
        )
        .await
        .map_err(|_| campaign_changed())?;
        let candidates = match self.selection {
            ClaimSelection::Manual => manual_candidates(&facts, self.mode),
            ClaimSelection::Automatic => {
                let pending = serial_frontier_pending(transaction, self.root_id, &facts).await?;
                automatic_candidates(&facts, self.mode, pending)
            }
        };
        if !candidates
            .iter()
            .any(|facts| compact(&facts.child.id) == self.child_id)
        {
            return Err(campaign_changed());
        }

        if let Some(existing) = launch_claim::Entity::find_by_id(self.child_id)
            .one(transaction)
            .await?
        {
            if existing.root_id != self.root_id {
                return Err(claim_conflict());
            }
            if existing.claim_id == self.identity.claim_id
                && existing.agent_run_id == intent.agent_run_id
                && existing.launch_effect_id == intent.effect_id
                && existing.launch_generation == self.identity.generation
            {
                return if reused {
                    Ok(())
                } else {
                    Err(claim_conflict())
                };
            }
            if self.identity.generation != existing.launch_generation.saturating_add(1) {
                return Err(claim_conflict());
            }
            validate_retry(transaction, &existing).await?;
            let updated = launch_claim::Entity::update_many()
                .col_expr(
                    launch_claim::Column::ClaimId,
                    Expr::value(self.identity.claim_id.clone()),
                )
                .col_expr(
                    launch_claim::Column::AgentRunId,
                    Expr::value(intent.agent_run_id.clone()),
                )
                .col_expr(
                    launch_claim::Column::LaunchEffectId,
                    Expr::value(intent.effect_id.clone()),
                )
                .col_expr(
                    launch_claim::Column::LaunchGeneration,
                    Expr::value(self.identity.generation),
                )
                .col_expr(
                    launch_claim::Column::LaunchedAt,
                    Expr::value(Utc::now().naive_utc()),
                )
                .filter(launch_claim::Column::TaskId.eq(&existing.task_id))
                .filter(launch_claim::Column::ClaimId.eq(&existing.claim_id))
                .filter(launch_claim::Column::LaunchGeneration.eq(existing.launch_generation))
                .exec(transaction)
                .await?;
            return if updated.rows_affected == 1 {
                Ok(())
            } else {
                Err(claim_conflict())
            };
        }

        launch_claim::ActiveModel {
            task_id: Set(self.child_id.to_owned()),
            root_id: Set(self.root_id.to_owned()),
            claim_id: Set(self.identity.claim_id.clone()),
            agent_run_id: Set(intent.agent_run_id.clone()),
            launch_effect_id: Set(intent.effect_id.clone()),
            launch_generation: Set(self.identity.generation),
            launched_at: Set(Utc::now().naive_utc()),
        }
        .insert(transaction)
        .await
        .map(|_| ())
        .map_err(|_| claim_conflict())
    }
}

pub(super) async fn serial_frontier_pending(
    database: &impl sea_orm::ConnectionTrait,
    root_id: &str,
    facts: &[ChildSchedulingFacts],
) -> Result<bool, sea_orm::DbErr> {
    let claims = launch_claim::Entity::find()
        .filter(launch_claim::Column::RootId.eq(root_id))
        .all(database)
        .await?;
    Ok(claims.into_iter().any(|claim| {
        facts
            .iter()
            .find(|facts| compact(&facts.child.id) == claim.task_id)
            .is_none_or(|facts| !facts.child.is_satisfied() || facts.has_live_work)
    }))
}

async fn validate_retry(
    transaction: &DatabaseTransaction,
    claim: &launch_claim::Model,
) -> Result<(), RunsPersistenceError> {
    let effect = launch_effect::Entity::find_by_id(&claim.launch_effect_id)
        .one(transaction)
        .await?
        .filter(|effect| effect.agent_run_id == claim.agent_run_id)
        .ok_or_else(claim_conflict)?;
    let run = agent_run::Entity::find_by_id(&claim.agent_run_id)
        .one(transaction)
        .await?
        .ok_or_else(claim_conflict)?;
    let terminals = session::Entity::find()
        .filter(session::Column::AgentRunId.eq(&claim.agent_run_id))
        .all(transaction)
        .await?;
    let inactive = run.ended_at.is_some()
        && terminals
            .iter()
            .all(|terminal| terminal.terminated_at.is_some() && !terminal.runtime_cleanup_pending);
    let ambiguous = effect.state != "applied" && effect.state != "failed"
        || matches!(
            effect.last_error_code.as_deref(),
            Some("terminal_runtime_identity_conflict" | "launch_runtime_conflict")
        );
    if !inactive || ambiguous || (effect.state == "failed" && effect.last_error_code.is_none()) {
        return Err(RunsPersistenceError::new(
            RunsPersistenceErrorCode::LaunchConflict,
            "The prior campaign launch is not inactive with confirmed cleanup and a recorded outcome.",
        ));
    }
    Ok(())
}

fn validate_intent(
    claim: &CampaignClaim<'_>,
    intent: &LaunchIntent,
) -> Result<(), RunsPersistenceError> {
    if intent.request_id != claim.identity.request_id || intent.issue_id != claim.child_id {
        return Err(claim_conflict());
    }
    Ok(())
}

fn derived(domain: &str, seed: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(domain.as_bytes());
    hash.update([0]);
    hash.update(seed.as_bytes());
    format!("{:x}", hash.finalize())[..32].to_owned()
}

fn parse_mode(value: &str) -> Option<ExecutionMode> {
    match value {
        "parallel" => Some(ExecutionMode::Parallel),
        "serial" => Some(ExecutionMode::Serial),
        _ => None,
    }
}

fn compact(value: &str) -> String {
    uuid::Uuid::parse_str(value)
        .map(|value| value.simple().to_string())
        .unwrap_or_else(|_| value.to_owned())
}

fn campaign_changed() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::LaunchConflict,
        "The Graph Run changed before launch preparation committed.",
    )
}

fn claim_conflict() -> RunsPersistenceError {
    RunsPersistenceError::new(
        RunsPersistenceErrorCode::LaunchConflict,
        "The Work Item campaign claim is already bound to another launch generation.",
    )
}
