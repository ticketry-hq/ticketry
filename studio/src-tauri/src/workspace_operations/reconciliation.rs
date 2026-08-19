//! Bounded, repeatable startup reconciliation.
//!
//! A restart cannot know whether a claimed operation ever reached the
//! filesystem or Git, and an expired lease is not permission to act again.
//! Every decision here starts from what a probe actually observed: an already
//! durable effect is adopted, a provably absent one may be executed again
//! under the same identity, a contradicting one becomes a durable conflict,
//! and anything unproven is left untouched for the next pass.
//!
//! Ambiguity is isolated by resource, not globally. When one document or one
//! repository cannot be decided, further operations on *that* subject are held
//! back within the pass while unrelated subjects keep converging — so a single
//! stuck checkout can never make the rest of the workspace unusable.

use std::collections::BTreeSet;
use std::sync::Arc;

use serde_json::json;

use super::{
    scan, ClaimedOperation, CleanupProgress, ExternalObservation, OperationSubject,
    ResourceIdentity, WorkspaceOperationError, WorkspaceOperationErrorCode,
    WorkspaceOperationExecutor, WorkspaceOperationJournal, WorkspaceOperationOutcome,
    WorkspaceOperationRecord, WorkspaceStateProbe,
};

/// Reconciliation claims are short: a pass that dies mid-decision must become
/// eligible again quickly, and nothing it does depends on a longer lease.
const RECONCILE_LEASE_SECONDS: i64 = 120;

/// One pass reconciles a bounded batch. Whatever is left is picked up by the
/// next pass, so a large backlog cannot stall startup.
pub const MAX_RECONCILIATION_BATCH: u64 = 200;

/// The typed conflict recorded when external state contradicts the intent.
pub const EXTERNAL_CONFLICT_CODE: &str = "workspace_external_conflict";

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReconciliationDecision {
    /// External state already held the intended effect; the operation was
    /// settled as applied rather than performed a second time.
    Adopted,
    /// The effect was provably absent, so it was executed again under the same
    /// identity. `state` is the operation's state after settlement.
    Executed { state: String },
    /// External state contradicted the intent. The operation is a durable,
    /// non-retryable conflict and its evidence is retained.
    Conflicted { code: String },
    /// The external effect is provably gone and the failure is now settled.
    CleanupCompleted,
    /// Cleanup could not be proven complete. The operation stays
    /// cleanup-pending with durable evidence.
    CleanupPending,
    /// Nothing was decided. The operation is untouched and stays due.
    Deferred { reason: String },
    /// Another operation on the same resource was undecided or conflicted
    /// earlier in this pass, so this one is held back. Unrelated resources are
    /// unaffected.
    Isolated,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReconciledOperation {
    pub operation_id: String,
    pub resource: ResourceIdentity,
    pub decision: ReconciliationDecision,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReconciliationReport {
    pub reconciled: Vec<ReconciledOperation>,
    /// How many due operations the bounded batch examined. A pass that fills
    /// its batch says so, rather than implying the backlog is empty.
    pub scanned: usize,
    pub batch_limit: u64,
}

impl ReconciliationReport {
    pub fn decision(&self, operation_id: &str) -> Option<&ReconciliationDecision> {
        let operation_id = super::intent::database_uuid(operation_id)?;
        self.reconciled
            .iter()
            .find(|entry| entry.operation_id == operation_id)
            .map(|entry| &entry.decision)
    }

    /// True when the batch was filled, so a supervising runtime knows to drain
    /// again rather than treat startup as complete.
    pub fn saturated(&self) -> bool {
        self.scanned as u64 >= self.batch_limit
    }
}

/// Drains the durable operation backlog. It owns no schedule: startup and any
/// supervising caller drive it, and every pass is idempotent.
#[derive(Clone)]
pub struct WorkspaceOperationReconciler {
    journal: WorkspaceOperationJournal,
    probe: Arc<dyn WorkspaceStateProbe>,
    executor: Arc<dyn WorkspaceOperationExecutor>,
    lease_owner: String,
}

impl WorkspaceOperationReconciler {
    pub(crate) fn new(
        journal: WorkspaceOperationJournal,
        probe: Arc<dyn WorkspaceStateProbe>,
        executor: Arc<dyn WorkspaceOperationExecutor>,
    ) -> Self {
        Self {
            journal,
            probe,
            executor,
            lease_owner: format!("workspace-reconciler-{}", uuid::Uuid::new_v4().simple()),
        }
    }

    pub fn lease_owner(&self) -> &str {
        &self.lease_owner
    }

    /// Reconcile every operation a crash could have abandoned.
    pub async fn reconcile(&self) -> Result<ReconciliationReport, WorkspaceOperationError> {
        let due = scan::due(self.journal.database(), MAX_RECONCILIATION_BATCH).await?;
        let mut isolated = BTreeSet::<ResourceIdentity>::new();
        let mut reconciled = Vec::with_capacity(due.len());
        let scanned = due.len();
        for record in due {
            let resource = record.resource();
            let decision = if isolated.contains(&resource) {
                ReconciliationDecision::Isolated
            } else {
                self.reconcile_one(&record).await?
            };
            if matches!(
                decision,
                ReconciliationDecision::Deferred { .. }
                    | ReconciliationDecision::Conflicted { .. }
                    | ReconciliationDecision::CleanupPending
            ) {
                isolated.insert(resource.clone());
            }
            reconciled.push(ReconciledOperation {
                operation_id: record.operation_id,
                resource,
                decision,
            });
        }
        Ok(ReconciliationReport {
            reconciled,
            scanned,
            batch_limit: MAX_RECONCILIATION_BATCH,
        })
    }

    /// Reconcile one operation. The observation is taken before any state
    /// change, so lease expiry alone never causes a second external effect.
    async fn reconcile_one(
        &self,
        record: &WorkspaceOperationRecord,
    ) -> Result<ReconciliationDecision, WorkspaceOperationError> {
        let Some(subject) = OperationSubject::of(record) else {
            return Ok(ReconciliationDecision::Deferred {
                reason: "The operation intent cannot be decoded by this build.".to_owned(),
            });
        };
        let observation = self.probe.observe(subject).await.sanitized();
        if record.state == "cleanup_pending" {
            return self.reconcile_cleanup(record, observation).await;
        }
        match observation {
            ExternalObservation::Applied { evidence } => self.adopt(record, evidence).await,
            ExternalObservation::Absent => self.execute_again(record).await,
            ExternalObservation::Conflicting { code, detail } => {
                self.record_conflict(record, code, detail).await
            }
            ExternalObservation::Uncertain { detail } => {
                Ok(ReconciliationDecision::Deferred { reason: detail })
            }
        }
    }

    /// Cleanup ends only when the remnant is provably gone. Every other answer
    /// keeps the operation cleanup-pending with fresh evidence.
    async fn reconcile_cleanup(
        &self,
        record: &WorkspaceOperationRecord,
        observation: ExternalObservation,
    ) -> Result<ReconciliationDecision, WorkspaceOperationError> {
        let progress = match &observation {
            ExternalObservation::Absent => CleanupProgress::Complete,
            ExternalObservation::Applied { evidence } => CleanupProgress::Pending {
                evidence: json!({ "survives": true, "observation": evidence }),
            },
            ExternalObservation::Conflicting { code, detail } => CleanupProgress::Pending {
                evidence: json!({ "conflict": code, "detail": detail }),
            },
            ExternalObservation::Uncertain { detail } => CleanupProgress::Pending {
                evidence: json!({ "uncertain": detail }),
            },
        };
        let complete = progress == CleanupProgress::Complete;
        self.journal
            .record_cleanup_progress(&record.operation_id, progress)
            .await?;
        Ok(if complete {
            ReconciliationDecision::CleanupCompleted
        } else {
            ReconciliationDecision::CleanupPending
        })
    }

    /// A provably absent effect is the only permission to act again, and the
    /// re-execution reuses the same operation identity.
    async fn execute_again(
        &self,
        record: &WorkspaceOperationRecord,
    ) -> Result<ReconciliationDecision, WorkspaceOperationError> {
        let claim = match self.claim(record).await {
            Ok(claim) => claim,
            Err(error) if contended(&error) => return Ok(deferred(error)),
            Err(error) => return Err(error),
        };
        let outcome = self.executor.execute(claim).await;
        match self
            .journal
            .settle(&record.operation_id, self.lease_owner(), outcome)
            .await
        {
            Ok(settled) => Ok(ReconciliationDecision::Executed {
                state: settled.operation.state,
            }),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    async fn adopt(
        &self,
        record: &WorkspaceOperationRecord,
        evidence: serde_json::Value,
    ) -> Result<ReconciliationDecision, WorkspaceOperationError> {
        let outcome = WorkspaceOperationOutcome::Applied {
            result: json!({ "adopted": true }),
            evidence,
        };
        match self.settle(record, outcome).await {
            Ok(()) => Ok(ReconciliationDecision::Adopted),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    async fn record_conflict(
        &self,
        record: &WorkspaceOperationRecord,
        code: String,
        detail: String,
    ) -> Result<ReconciliationDecision, WorkspaceOperationError> {
        let outcome = WorkspaceOperationOutcome::Conflicted {
            code: code.clone(),
            message: detail.clone(),
            evidence: json!({
                "conflict": code,
                "detail": detail,
                "adopted": false,
            }),
        };
        match self.settle(record, outcome).await {
            Ok(()) => Ok(ReconciliationDecision::Conflicted { code }),
            Err(error) if contended(&error) => Ok(deferred(error)),
            Err(error) => Err(error),
        }
    }

    /// Take the operation through the same claim an executor would need, so a
    /// reconciler that loses the compare-and-set writes nothing at all.
    async fn settle(
        &self,
        record: &WorkspaceOperationRecord,
        outcome: WorkspaceOperationOutcome,
    ) -> Result<(), WorkspaceOperationError> {
        self.claim(record).await?;
        self.journal
            .settle(&record.operation_id, self.lease_owner(), outcome)
            .await
            .map(|_| ())
    }

    async fn claim(
        &self,
        record: &WorkspaceOperationRecord,
    ) -> Result<ClaimedOperation, WorkspaceOperationError> {
        self.journal
            .claim(
                &record.operation_id,
                self.lease_owner(),
                RECONCILE_LEASE_SECONDS,
            )
            .await
    }
}

/// Another worker claimed or settled the operation first, or this build cannot
/// decode it. Both are normal concurrent outcomes, not pass failures.
fn contended(error: &WorkspaceOperationError) -> bool {
    matches!(
        error.code(),
        WorkspaceOperationErrorCode::Busy
            | WorkspaceOperationErrorCode::AlreadySettled
            | WorkspaceOperationErrorCode::LeaseNotHeld
            | WorkspaceOperationErrorCode::UnsupportedVersion
    )
}

fn deferred(error: WorkspaceOperationError) -> ReconciliationDecision {
    ReconciliationDecision::Deferred {
        reason: error.to_string(),
    }
}
