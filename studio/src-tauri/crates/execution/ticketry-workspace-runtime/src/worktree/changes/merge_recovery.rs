use serde_json::json;

use crate::workspace::operations::{WorkspaceOperationJournal, WorkspaceOperationKind};
use crate::worktree::{create, status};

use super::merge_executor::MergeExecutor;
use super::merge_git::git_ref;
use super::merge_identity::MergeIntent;
use super::merge_inspection::{MergeLocation, MergeState};
use super::merge_result::{result, WorktreeMergePath, WorktreeMergeResult};
use super::{command_git, WorktreeChangesError, WorktreeChangesService};

impl WorktreeChangesService {
    pub async fn merge_recovery(
        &self,
        task_id: &str,
    ) -> Result<Option<WorktreeMergeResult>, WorktreeChangesError> {
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let Some(operation) = WorkspaceOperationJournal::new(self.status().work_items().clone())
            .find_latest_conflicted(
                WorkspaceOperationKind::WorktreeMerge,
                &create::identity::resource_key(&owner.top_level_row_id()),
            )
            .await
            .map_err(WorktreeChangesError::merge_operation)?
        else {
            return Ok(None);
        };
        let Some(intent) = operation
            .intent_payload()
            .as_ref()
            .and_then(MergeIntent::decode)
            .filter(|intent| {
                intent.task_id == owner.top_level_row_id() && intent.action == "merge"
            })
        else {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_operation_mismatch",
                "The stored merge recovery identity is invalid.",
            ));
        };
        let executor = MergeExecutor::new(
            self.status().clone(),
            WorkspaceOperationJournal::new(self.status().work_items().clone()),
        );
        let (repository, _) = self.repository_for(&intent.task_id).await?;
        let _guard = self.status().repository_locks().acquire(&repository).await;
        let value = match executor.inspect(&intent, false).await? {
            MergeState::Applied(location) => {
                self.retire_merge_recovery(result(
                    &operation.operation_id,
                    &intent,
                    "merged",
                    location,
                    Vec::new(),
                ))
                .await?
            }
            MergeState::Ready(location) => {
                self.retire_merge_recovery(result(
                    &operation.operation_id,
                    &intent,
                    "aborted",
                    location,
                    Vec::new(),
                ))
                .await?
            }
            MergeState::Conflicted(location, paths) => result(
                &operation.operation_id,
                &intent,
                "conflicted",
                location,
                paths
                    .into_iter()
                    .map(|path| WorktreeMergePath { path })
                    .collect(),
            ),
        };
        Ok(Some(value))
    }

    pub async fn finish_merge(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        let (intent, terminal) = self.recovery_intent(task_id, operation_id).await?;
        if let Some(result) = terminal {
            return Ok(result);
        }
        let executor = MergeExecutor::new(
            self.status().clone(),
            WorkspaceOperationJournal::new(self.status().work_items().clone()),
        );
        let (repository, _) = self.repository_for(&intent.task_id).await?;
        let _guard = self.status().repository_locks().acquire(&repository).await;
        match executor.inspect(&intent, false).await? {
            MergeState::Applied(location) => {
                self.retire_merge_recovery(result(
                    operation_id,
                    &intent,
                    "merged",
                    location,
                    Vec::new(),
                ))
                .await
            }
            MergeState::Conflicted(_, paths) if !paths.is_empty() => {
                Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_unresolved",
                    "Resolve and stage every unmerged path before finishing the merge.",
                ))
            }
            MergeState::Conflicted(location, _) => {
                let committed = self
                    .status()
                    .git()
                    .run(&["commit", "--no-edit"], &location.destination)
                    .await?;
                match executor.inspect(&intent, false).await? {
                    MergeState::Applied(location) => {
                        self.retire_merge_recovery(result(
                            operation_id,
                            &intent,
                            "merged",
                            location,
                            Vec::new(),
                        ))
                        .await
                    }
                    _ => Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_git_failed",
                        crate::workspace::operations::redact_diagnostic(&committed.stderr),
                    )),
                }
            }
            MergeState::Ready(_) => Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_not_in_progress",
                "The matching merge is no longer in progress.",
            )),
        }
    }

    pub async fn abort_merge(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        let (intent, terminal) = self.recovery_intent(task_id, operation_id).await?;
        if let Some(result) = terminal {
            return Ok(result);
        }
        let executor = MergeExecutor::new(
            self.status().clone(),
            WorkspaceOperationJournal::new(self.status().work_items().clone()),
        );
        let (repository, _) = self.repository_for(&intent.task_id).await?;
        let _guard = self.status().repository_locks().acquire(&repository).await;
        match executor.inspect(&intent, false).await? {
            MergeState::Applied(location) => {
                self.retire_merge_recovery(result(
                    operation_id,
                    &intent,
                    "merged",
                    location,
                    Vec::new(),
                ))
                .await
            }
            MergeState::Conflicted(location, _) => {
                let aborted = self
                    .status()
                    .git()
                    .run(&["merge", "--abort"], &location.destination)
                    .await?;
                let head =
                    command_git::head_commit(self.status().git(), &location.destination).await?;
                if !aborted.succeeded
                    || git_ref(self.status().git(), &location.destination, "MERGE_HEAD")
                        .await?
                        .is_some()
                    || head != intent.destination_commit
                {
                    return Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_abort_failed",
                        crate::workspace::operations::redact_diagnostic(&aborted.stderr),
                    ));
                }
                self.retire_merge_recovery(result(
                    operation_id,
                    &intent,
                    "aborted",
                    MergeLocation {
                        destination: location.destination,
                        destination_head: head,
                    },
                    Vec::new(),
                ))
                .await
            }
            MergeState::Ready(location) => {
                self.retire_merge_recovery(result(
                    operation_id,
                    &intent,
                    "aborted",
                    location,
                    Vec::new(),
                ))
                .await
            }
        }
    }

    async fn retire_merge_recovery(
        &self,
        result: WorktreeMergeResult,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        WorkspaceOperationJournal::new(self.status().work_items().clone())
            .retire_conflict(
                &result.operation_id,
                serde_json::to_value(&result).expect("serialize merge result"),
                json!({
                    "destinationCheckout": &result.destination_checkout,
                    "outcome": &result.outcome,
                }),
            )
            .await
            .map_err(WorktreeChangesError::merge_operation)?;
        Ok(result)
    }

    async fn recovery_intent(
        &self,
        task_id: &str,
        operation_id: &str,
    ) -> Result<(MergeIntent, Option<WorktreeMergeResult>), WorktreeChangesError> {
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let operation = WorkspaceOperationJournal::new(self.status().work_items().clone())
            .find(operation_id)
            .await
            .map_err(WorktreeChangesError::merge_operation)?
            .ok_or_else(|| {
                WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_mismatch",
                    "The merge operation does not exist.",
                )
            })?;
        let terminal = operation
            .result()
            .and_then(|result| serde_json::from_value(result).ok());
        let intent = operation
            .intent_payload()
            .as_ref()
            .and_then(MergeIntent::decode)
            .filter(|intent| {
                operation.typed_kind() == Some(WorkspaceOperationKind::WorktreeMerge)
                    && (operation.state == "conflicted" || terminal.is_some())
                    && intent.task_id == owner.top_level_row_id()
                    && intent.action == "merge"
            })
            .ok_or_else(|| {
                WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_mismatch",
                    "This operation is not the matching recoverable merge.",
                )
            })?;
        Ok((intent, terminal))
    }
}
