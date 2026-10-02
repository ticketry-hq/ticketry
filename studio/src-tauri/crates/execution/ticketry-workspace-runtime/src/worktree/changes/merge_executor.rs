use async_trait::async_trait;
use sea_orm::EntityTrait;
use serde_json::json;
use ticketry_entities::worktree;

use crate::workspace::operations::{
    ClaimedOperation, WorkspaceOperationExecutor, WorkspaceOperationJournal,
    WorkspaceOperationOutcome,
};
use crate::worktree::status::WorktreeStatusService;

use super::merge_identity::MergeIntent;
use super::merge_inspection::MergeState;
use super::merge_result::{
    blocked_failure, failed, failure, merge_conflict_outcome, outcome_name, result, stale,
    unverified_failure, WorktreeMergePath, WorktreeMergeResult,
};
use super::{repository, WorktreeChangesError};

#[derive(Clone)]
pub(super) struct MergeExecutor {
    pub(super) status: WorktreeStatusService,
    pub(super) journal: WorkspaceOperationJournal,
}

impl MergeExecutor {
    pub(super) fn new(status: WorktreeStatusService, journal: WorkspaceOperationJournal) -> Self {
        Self { status, journal }
    }

    pub(super) async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
        let Some(intent) = MergeIntent::decode(&claim.payload) else {
            return self
                .settled(
                    claim,
                    failed(
                        "worktree_merge_intent_invalid",
                        "The merge intent is invalid.",
                    ),
                )
                .await;
        };
        let repository = match worktree::Entity::find_by_id(&intent.worktree_id)
            .one(self.status.work_items())
            .await
        {
            Ok(Some(row)) => match repository::recorded_repository(&row.repo_root) {
                Ok(repository) => repository,
                Err(error) => return self.settled(claim, failure(error)).await,
            },
            Ok(None) => {
                return self
                    .settled(
                        claim,
                        blocked_failure(stale("The source worktree record changed.")),
                    )
                    .await
            }
            Err(error) => {
                return self
                    .settled(
                        claim,
                        failed("worktree_merge_storage_failed", error.to_string()),
                    )
                    .await
            }
        };
        let _guard = self.status.repository_locks().acquire(&repository).await;
        let state = match self.inspect(&intent, true).await {
            Ok(state) => state,
            Err(error) => return self.settled(claim, blocked_failure(error)).await,
        };
        let location = match state {
            MergeState::Applied(_) => None,
            MergeState::Ready(location) => Some(location),
            MergeState::Conflicted(location, paths) => {
                return self
                    .settled(claim, merge_conflict_outcome(location, paths))
                    .await;
            }
        };
        if let Some(location) = location {
            let arguments = [
                "merge",
                if intent.action == "merge" {
                    "--no-ff"
                } else {
                    "--ff-only"
                },
                "--no-squash",
                "--commit",
                "--no-edit",
                &intent.source_commit,
            ];
            let merged = self
                .status
                .git()
                .run(&arguments, &location.destination)
                .await;
            let after = self.inspect(&intent, false).await;
            match after {
                Ok(MergeState::Applied(_)) => {}
                Ok(MergeState::Conflicted(location, paths)) => {
                    return self
                        .settled(claim, merge_conflict_outcome(location, paths))
                        .await;
                }
                Ok(MergeState::Ready(_)) => {
                    let detail = merged
                        .ok()
                        .map(|outcome| outcome.stderr)
                        .unwrap_or_default();
                    return self
                        .settled(
                            claim,
                            WorkspaceOperationOutcome::Failed {
                                code: "worktree_merge_git_failed".to_owned(),
                                message: if detail.trim().is_empty() {
                                    "Git did not complete the merge.".to_owned()
                                } else {
                                    crate::workspace::operations::redact_diagnostic(&detail)
                                },
                                retryable: true,
                                cleanup_confirmed: true,
                            },
                        )
                        .await;
                }
                Err(error) => return self.settled(claim, unverified_failure(error)).await,
            }
        }
        self.settled(
            claim,
            WorkspaceOperationOutcome::Applied {
                result: json!({ "outcome": outcome_name(&intent) }),
                evidence: json!({
                    "sourceBranch": intent.source_branch,
                    "sourceCommit": intent.source_commit,
                    "destinationBranch": intent.destination_branch,
                }),
            },
        )
        .await
    }

    pub(super) async fn result(
        &self,
        operation_id: &str,
        intent: &MergeIntent,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        let row = worktree::Entity::find_by_id(&intent.worktree_id)
            .one(self.status.work_items())
            .await?
            .ok_or_else(|| stale("The source worktree record changed."))?;
        let repository = repository::recorded_repository(&row.repo_root)?;
        let _guard = self.status.repository_locks().acquire(&repository).await;
        let (location, outcome, unmerged_paths) = match self.inspect(intent, false).await? {
            MergeState::Applied(location) => (location, outcome_name(intent), Vec::new()),
            MergeState::Conflicted(location, paths) => (
                location,
                "conflicted",
                paths
                    .into_iter()
                    .map(|path| WorktreeMergePath { path })
                    .collect(),
            ),
            MergeState::Ready(_) => return Err(stale("The merge result could not be verified.")),
        };
        Ok(result(
            operation_id,
            intent,
            outcome,
            location,
            unmerged_paths,
        ))
    }

    async fn settled(
        &self,
        claim: &ClaimedOperation,
        outcome: WorkspaceOperationOutcome,
    ) -> WorkspaceOperationOutcome {
        match self
            .journal
            .settle(&claim.operation_id, &claim.lease_owner, outcome.clone())
            .await
        {
            Ok(_) => outcome,
            Err(error) => failed("worktree_merge_settlement_failed", error.to_string()),
        }
    }
}

#[async_trait]
impl WorkspaceOperationExecutor for MergeExecutor {
    async fn execute(&self, claim: ClaimedOperation) -> WorkspaceOperationOutcome {
        self.perform(&claim).await
    }
}
