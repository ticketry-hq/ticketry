//! Committing a proved checkout.
//!
//! The index row, its durable fact, and the Applied outcome settle in one
//! transaction. That transaction first re-reads where the owner sits: a
//! reparent that committed while Git was cutting the checkout turns the
//! outcome into a conflict instead of a row under the module the task left.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::json;

use crate::workspace::operations::{
    ClaimedOperation, WorkspaceOperationError, WorkspaceOperationOutcome,
};

use super::error::WorktreeCreateError;
use super::executor::{conflicted, CreateExecutor};
use super::plan::CreatePlan;
use super::settlement::{self, SettledWorktree};

impl CreateExecutor {
    /// Settle a proved checkout together with its row and its durable fact.
    pub(super) async fn settle_created(
        &self,
        claim: &ClaimedOperation,
        plan: &CreatePlan,
        settled: SettledWorktree,
    ) -> WorkspaceOperationOutcome {
        let outcome = WorkspaceOperationOutcome::Applied {
            result: settled.result(plan),
            evidence: json!({
                "adopted": settled.adopted,
                "branch": plan.branch,
                "baseRef": settled.base_ref,
                "baseCommit": settled.base_commit,
                "checkoutName": plan.checkout_name,
                "worktreeId": settled.worktree_id,
            }),
        };
        let events = self.events().cloned();
        let settlement_outcome = outcome.clone();
        // Resolved before the transaction opens: the fact's project and owner
        // come from the Work Item graph, and reading them is not settlement
        // work that should hold the settlement transaction open.
        let scope =
            crate::worktree::facts::resolve_scope(self.work_items(), &plan.owner.top_level_task_id)
                .await;
        let moved = Arc::new(AtomicBool::new(false));
        let written = self
            .journal()
            .settle_with(
                &claim.operation_id,
                &claim.lease_owner,
                settlement_outcome,
                |transaction| {
                    let plan = plan.clone();
                    let settled = settled.clone();
                    let events = events.clone();
                    let scope = scope.clone();
                    let moved = moved.clone();
                    Box::pin(async move {
                        if !settlement::owner_unmoved(transaction, &plan)
                            .await
                            .map_err(settlement_failure)?
                        {
                            moved.store(true, Ordering::Relaxed);
                            return Err(WorkspaceOperationError::settlement(
                                "The Work Item moved to another module during creation.",
                            ));
                        }
                        settlement::insert_row(transaction, &plan, &settled)
                            .await
                            .map_err(settlement_failure)?;
                        settlement::append_fact(
                            events.as_ref(),
                            transaction,
                            scope.as_ref(),
                            &plan,
                            &settled,
                        )
                        .await
                        .map_err(settlement_failure)
                    })
                },
            )
            .await;
        match written {
            Ok(_) => {
                if let Some(events) = self.events() {
                    // Waking subscribers happens only after the transaction
                    // committed, so nothing is published that did not commit.
                    events.wake_committed();
                }
                outcome
            }
            // The Applied settlement rolled back whole, so the durable
            // outcome becomes a conflict and no row names the old module.
            Err(_) if moved.load(Ordering::Relaxed) => {
                self.settled(
                    claim,
                    conflicted(
                        "worktree_owner_module_changed",
                        "The Work Item moved to another module while its checkout was being created.",
                        json!({
                            "branch": plan.branch,
                            "checkoutName": plan.checkout_name,
                            "intendedModuleId": plan.owner.module_id,
                        }),
                    ),
                )
                .await
            }
            Err(error) => WorkspaceOperationOutcome::Failed {
                code: error.code_str().to_owned(),
                message: error.to_string(),
                // The checkout is real and proved; only its bookkeeping
                // failed, so the next attempt adopts rather than recreates.
                retryable: true,
                cleanup_confirmed: true,
            },
        }
    }
}

fn settlement_failure(error: WorktreeCreateError) -> WorkspaceOperationError {
    WorkspaceOperationError::settlement(error.to_string())
}
