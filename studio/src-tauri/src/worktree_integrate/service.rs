//! The one place an automatic integration is started.
//!
//! Its whole public surface is "here is a committed completion" and "here is
//! the backlog of committed completions", because integration is a consequence
//! of finishing work, not an action anyone takes. There is no land endpoint, no
//! caller-supplied operation identity, and no way to ask for a checkout other
//! than the one the completing Work Item owns.
//!
//! Repetition is ordinary. Re-delivering an occurrence lands on the same
//! durable operation and replays its recorded outcome; a completion whose Work
//! Item owns no checkout is a no-op; a cancellation is a no-op; and a landing
//! interrupted by a restart is finished by the reconciler through the very same
//! executor.

use std::sync::Arc;

use sea_orm::DatabaseConnection;

use crate::runs_persistence::StatusEventRepository;
use crate::settings_persistence::ProfileStore;
use crate::workspace_operations::{
    WorkspaceOperationJournal, WorkspaceOperationOutcome, WorkspaceOperationReconciler,
};
use crate::worktree_status::identity::compact_uuid;
use crate::worktree_status::RepositoryLocks;

use super::delivery::{self, DeliveryOutcome, IntegrationDelivery, COMPLETED_GROUP};
use super::error::WorktreeIntegrateError;
use super::executor::IntegrateExecutor;
use super::identity;
use super::plan::{self, PlanResolution};
use super::probe::IntegrateProbe;

/// A landing is a short sequence of Git commands over one repository. The lease
/// covers all of them, and a worker that dies mid-sequence must become eligible
/// again quickly.
const INTEGRATE_LEASE_SECONDS: i64 = 300;

/// How many committed completions one bounded pass considers.
pub const MAX_DELIVERY_BATCH: u64 = 64;

#[derive(Clone)]
pub struct WorktreeIntegrateService {
    executor: IntegrateExecutor,
}

impl WorktreeIntegrateService {
    pub fn new(
        work_items: DatabaseConnection,
        profiles: ProfileStore,
        journal: WorkspaceOperationJournal,
        events: Option<StatusEventRepository>,
        locks: RepositoryLocks,
    ) -> Self {
        Self {
            executor: IntegrateExecutor::new(work_items, profiles, journal, events, locks),
        }
    }

    /// The reconciler that finishes abandoned landings at startup. It probes
    /// external state before it acts and executes through the very same
    /// executor a delivered completion uses.
    pub fn reconciler(&self) -> WorkspaceOperationReconciler {
        self.executor.journal().reconcile_with(
            Arc::new(IntegrateProbe::new(self.executor.clone())),
            Arc::new(self.executor.clone()),
        )
    }

    /// Deliver every committed completion that still owes an integration,
    /// bounded by `limit`.
    ///
    /// The pass is idempotent: an occurrence whose operation already settled
    /// replays it, and an occurrence whose Work Item no longer owns a checkout
    /// is skipped. Whatever the bound leaves is considered by the next pass.
    pub async fn deliver_pending(
        &self,
        limit: u64,
    ) -> Result<Vec<IntegrationDelivery>, WorktreeIntegrateError> {
        let mut delivered = Vec::new();
        for occurrence in delivery::pending(self.executor.work_items(), limit).await? {
            if let Some(delivery) = self.integrate(&occurrence).await? {
                delivered.push(delivery);
            }
        }
        Ok(delivered)
    }

    /// Deliver one committed completion by identity. `None` means the
    /// occurrence asks for nothing: an unknown occurrence, a destination that
    /// is not a completed group, or a Work Item that owns no checkout.
    pub async fn deliver(
        &self,
        occurrence_id: &str,
    ) -> Result<Option<IntegrationDelivery>, WorktreeIntegrateError> {
        let Some(occurrence) =
            delivery::occurrence(self.executor.work_items(), occurrence_id).await?
        else {
            return Ok(None);
        };
        self.integrate(&occurrence).await
    }

    async fn integrate(
        &self,
        occurrence: &crate::entities::work_management::transition_occurrence::Model,
    ) -> Result<Option<IntegrationDelivery>, WorktreeIntegrateError> {
        // A cancelled Work Item is terminal but is never landed.
        if occurrence.to_group != COMPLETED_GROUP {
            return Ok(None);
        }
        let completed = compact_uuid(&occurrence.issue_id);
        // A re-delivered occurrence answers from its own durable operation
        // before anything is re-derived, because the successful landing it
        // already performed removed the very row a fresh derivation would look
        // for. Re-delivery returns that operation; it never starts a second one.
        if let Some(durable) = self
            .executor
            .journal()
            .find(&identity::operation_id(
                &completed,
                &occurrence.occurrence_id,
            ))
            .await?
            .filter(|operation| operation.is_terminal())
        {
            return Ok(Some(IntegrationDelivery {
                occurrence_id: occurrence.occurrence_id.clone(),
                task_id: completed,
                operation_id: durable.operation_id,
                outcome: DeliveryOutcome::Replayed {
                    state: durable.state,
                },
            }));
        }
        let plan = match plan::derive(
            self.executor.work_items(),
            self.executor.profiles(),
            self.executor.git(),
            &completed,
        )
        .await?
        {
            // A child shares its parent's checkout without owning it, so
            // completing the child asks for nothing.
            PlanResolution::Plan(plan) if plan.top_level_row_id != completed => return Ok(None),
            PlanResolution::Plan(plan) => *plan,
            PlanResolution::NoWorktree => return Ok(None),
            PlanResolution::NoRepository(reason) => {
                return Ok(Some(self.deferred(occurrence, &completed, reason.to_owned())))
            }
            PlanResolution::Mismatched { detail, .. } => {
                return Ok(Some(self.deferred(occurrence, &completed, detail)))
            }
        };

        let intent = identity::intent(&plan, &occurrence.occurrence_id);
        let operation_id = intent.operation_id.clone();
        let prepared = match self.executor.journal().prepare(intent).await {
            Ok(prepared) => prepared,
            Err(error) => {
                return Ok(Some(self.deferred(occurrence, &completed, error.to_string())))
            }
        };
        // A duplicate delivery of the same occurrence answers from the durable
        // operation rather than starting a second landing.
        if prepared.reused && prepared.operation.is_terminal() {
            return Ok(Some(IntegrationDelivery {
                occurrence_id: occurrence.occurrence_id.clone(),
                task_id: completed,
                operation_id,
                outcome: DeliveryOutcome::Replayed {
                    state: prepared.operation.state.clone(),
                },
            }));
        }

        let claim = match self
            .executor
            .journal()
            .claim(&operation_id, &lease_owner(), INTEGRATE_LEASE_SECONDS)
            .await
        {
            Ok(claim) => claim,
            Err(error) => {
                return Ok(Some(self.deferred(occurrence, &completed, error.to_string())))
            }
        };
        Ok(Some(IntegrationDelivery {
            occurrence_id: occurrence.occurrence_id.clone(),
            task_id: completed,
            operation_id,
            outcome: outcome_of(self.executor.perform(&claim).await),
        }))
    }

    fn deferred(
        &self,
        occurrence: &crate::entities::work_management::transition_occurrence::Model,
        task_id: &str,
        reason: String,
    ) -> IntegrationDelivery {
        IntegrationDelivery {
            occurrence_id: occurrence.occurrence_id.clone(),
            task_id: task_id.to_owned(),
            operation_id: identity::operation_id(task_id, &occurrence.occurrence_id),
            outcome: DeliveryOutcome::Deferred { reason },
        }
    }
}

fn outcome_of(outcome: WorkspaceOperationOutcome) -> DeliveryOutcome {
    match outcome {
        WorkspaceOperationOutcome::Applied { .. } => DeliveryOutcome::Integrated,
        WorkspaceOperationOutcome::Conflicted { code, .. } => DeliveryOutcome::Conflicted { code },
        WorkspaceOperationOutcome::Failed {
            code,
            retryable: false,
            ..
        } => DeliveryOutcome::Refused { code },
        WorkspaceOperationOutcome::Failed { code, message, .. } => DeliveryOutcome::Deferred {
            reason: format!("{code}: {message}"),
        },
    }
}

/// A lease owner that names this process's attempt, so a settlement can only be
/// reported by the worker that claimed it.
fn lease_owner() -> String {
    format!("worktree-integrate-{}", uuid::Uuid::new_v4().simple())
}
