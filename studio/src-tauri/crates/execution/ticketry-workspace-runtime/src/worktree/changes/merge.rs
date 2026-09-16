use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use seaography::CustomOutputType;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ticketry_entities::worktree;

use crate::workspace::operations::{
    ClaimedOperation, ExternalObservation, OperationSubject, WorkspaceOperationExecutor,
    WorkspaceOperationJournal, WorkspaceOperationKind, WorkspaceOperationOutcome,
    WorkspaceOperationReconciler, WorkspaceStateProbe,
};
use crate::worktree::create;
use crate::worktree::status::{self, WorktreeStatusService};

use super::merge_identity::{self, MergeIntent};
use super::{command_git, merge_preview, repository, WorktreeChangesError, WorktreeChangesService};

const MERGE_LEASE_SECONDS: i64 = 120;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeMergePath {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct WorktreeMergeResult {
    pub operation_id: String,
    pub outcome: String,
    pub source_branch: String,
    pub source_commit: String,
    pub destination_branch: String,
    pub destination_commit: String,
    pub destination_checkout: String,
    pub unmerged_paths: Vec<WorktreeMergePath>,
    pub blocker: Option<String>,
    pub reason: Option<String>,
}

impl WorktreeChangesService {
    pub fn merge_reconciler(&self) -> WorkspaceOperationReconciler {
        let executor = MergeExecutor::new(
            self.status().clone(),
            WorkspaceOperationJournal::new(self.status().work_items().clone()),
        );
        executor.journal.clone().reconcile_with(
            Arc::new(MergeProbe::new(executor.clone())),
            Arc::new(executor),
        )
    }

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

    pub async fn merge(
        &self,
        task_id: &str,
        operation_id: &str,
        destination_branch: &str,
        confirmation_token: &str,
    ) -> Result<WorktreeMergeResult, WorktreeChangesError> {
        let journal = WorkspaceOperationJournal::new(self.status().work_items().clone());
        let owner = status::owner::resolve(self.status().work_items(), task_id).await?;
        let existing = journal
            .find(operation_id)
            .await
            .map_err(WorktreeChangesError::merge_operation)?;
        let operation = match existing {
            Some(operation) => {
                let matches = operation
                    .intent_payload()
                    .as_ref()
                    .and_then(MergeIntent::decode)
                    .is_some_and(|intent| {
                        intent.task_id == owner.top_level_row_id()
                            && intent.destination_branch == destination_branch
                            && merge_preview::confirmation_token(
                                &intent.worktree_id,
                                &intent.source_branch,
                                &intent.source_commit,
                                &intent.destination_branch,
                                &intent.destination_commit,
                                &intent.destination_checkout_identity,
                            ) == confirmation_token
                    });
                if !matches {
                    return Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_operation_mismatch",
                        "This operation identity belongs to a different merge intent.",
                    ));
                }
                operation
            }
            None => {
                let preview = self
                    .merge_preview(task_id, Some(destination_branch))
                    .await?;
                if !preview.ready
                    || preview.confirmation_token.as_deref() != Some(confirmation_token)
                {
                    return Err(WorktreeChangesError::merge_blocked(
                        "worktree_merge_preview_stale",
                        "The merge preview changed. Refresh and confirm it again.",
                    ));
                }
                let source_commit = preview.source_commit.expect("ready preview source commit");
                let destination_commit = preview
                    .destination_commit
                    .expect("ready preview destination commit");
                let source_is_ancestor = is_ancestor(
                    self.status(),
                    &source_commit,
                    &destination_commit,
                    self.repository_for(&owner.top_level_row_id())
                        .await?
                        .0
                        .as_path(),
                )
                .await?;
                let destination_is_ancestor = is_ancestor(
                    self.status(),
                    &destination_commit,
                    &source_commit,
                    self.repository_for(&owner.top_level_row_id())
                        .await?
                        .0
                        .as_path(),
                )
                .await?;
                let action = if source_is_ancestor {
                    "already_integrated"
                } else if destination_is_ancestor {
                    "fast_forward"
                } else {
                    "merge"
                };
                let row = worktree::Entity::find()
                    .filter(worktree::Column::TaskId.eq(owner.top_level_row_id()))
                    .one(self.status().work_items())
                    .await?
                    .ok_or_else(WorktreeChangesError::not_found)?;
                let intent = MergeIntent {
                    worktree_id: row.id,
                    task_id: owner.top_level_row_id(),
                    repository_digest: create::identity::repository_digest(
                        &repository::recorded_repository(&row.repo_root)?,
                    ),
                    source_branch: preview.source_branch,
                    source_commit,
                    destination_branch: destination_branch.to_owned(),
                    destination_commit,
                    destination_checkout_identity: preview
                        .destination_checkout_identity
                        .expect("ready preview checkout identity"),
                    action: action.to_owned(),
                };
                journal
                    .prepare(merge_identity::intent(operation_id, &intent))
                    .await
                    .map_err(WorktreeChangesError::merge_operation)?
                    .operation
            }
        };

        let intent = operation
            .intent_payload()
            .as_ref()
            .and_then(MergeIntent::decode)
            .ok_or_else(|| {
                WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_invalid",
                    "The prepared merge cannot be decoded by this build.",
                )
            })?;
        let executor = MergeExecutor::new(self.status().clone(), journal.clone());
        if operation.state == "conflicted" {
            return executor.result(operation_id, &intent).await;
        }
        if operation.state != "applied" {
            let claim = journal
                .claim(operation_id, &lease_owner(), MERGE_LEASE_SECONDS)
                .await
                .map_err(WorktreeChangesError::merge_operation)?;
            match executor.perform(&claim).await {
                WorkspaceOperationOutcome::Applied { .. } => {}
                WorkspaceOperationOutcome::Conflicted { .. } => {}
                WorkspaceOperationOutcome::Failed { code, message, .. } => {
                    return Err(WorktreeChangesError::merge_blocked(
                        merge_error_code(&code),
                        message,
                    ))
                }
            }
        }
        executor.result(operation_id, &intent).await
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

    async fn repository_for(
        &self,
        task_id: &str,
    ) -> Result<(PathBuf, worktree::Model), WorktreeChangesError> {
        let row = worktree::Entity::find()
            .filter(worktree::Column::TaskId.eq(task_id))
            .one(self.status().work_items())
            .await?
            .ok_or_else(WorktreeChangesError::not_found)?;
        Ok((repository::recorded_repository(&row.repo_root)?, row))
    }
}

#[derive(Clone)]
struct MergeExecutor {
    status: WorktreeStatusService,
    journal: WorkspaceOperationJournal,
}

struct MergeLocation {
    destination: PathBuf,
    destination_head: String,
}

enum MergeState {
    Ready(MergeLocation),
    Applied(MergeLocation),
    Conflicted(MergeLocation, Vec<String>),
}

impl MergeExecutor {
    fn new(status: WorktreeStatusService, journal: WorkspaceOperationJournal) -> Self {
        Self { status, journal }
    }

    async fn inspect(
        &self,
        intent: &MergeIntent,
        require_current_source: bool,
    ) -> Result<MergeState, WorktreeChangesError> {
        let row = worktree::Entity::find_by_id(&intent.worktree_id)
            .one(self.status.work_items())
            .await?
            .ok_or_else(|| stale("The source worktree record changed."))?;
        if row.task_id != intent.task_id || row.branch != intent.source_branch {
            return Err(stale("The source worktree identity changed."));
        }
        let (repository, source) = repository::recorded_paths(&row.repo_root, &row.path)?;
        if create::identity::repository_digest(&repository) != intent.repository_digest {
            return Err(stale("The source repository changed."));
        }
        let registered = status::registry::checkouts(self.status.git(), &repository).await?;
        if !registered.iter().any(|entry| {
            entry.branch.as_deref() == Some(intent.source_branch.as_str())
                && status::registry::same_path(&entry.path, &source)
        }) {
            return Err(stale("The source checkout no longer owns its branch."));
        }
        let destination = registered
            .iter()
            .find(|entry| entry.branch.as_deref() == Some(intent.destination_branch.as_str()))
            .map(|entry| PathBuf::from(&entry.path).canonicalize())
            .transpose()
            .map_err(|_| stale("The destination checkout is unavailable."))?
            .ok_or_else(|| stale("The destination checkout no longer owns its branch."))?;
        if merge_preview::checkout_identity(&destination) != intent.destination_checkout_identity {
            return Err(stale("The destination checkout changed after preview."));
        }
        repository::validate_membership(self.status.git(), &repository, &source).await?;
        repository::validate_membership(self.status.git(), &repository, &destination).await?;
        if require_current_source {
            if merge_preview::in_progress(self.status.git(), &source).await? {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_in_progress",
                    "Finish or abort the existing Git operation, then preview again.",
                ));
            }
            if !command_git::status(self.status.git(), &source)
                .await?
                .stdout
                .is_empty()
            {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_dirty",
                    "The source checkout must remain clean.",
                ));
            }
            let source_head = command_git::head_commit(self.status.git(), &source).await?;
            if source_head != intent.source_commit {
                return Err(stale("The source branch changed after preview."));
            }
        }
        let destination_head = command_git::head_commit(self.status.git(), &destination).await?;
        let location = MergeLocation {
            destination,
            destination_head: destination_head.clone(),
        };
        if let Some(merge_head) =
            git_ref(self.status.git(), &location.destination, "MERGE_HEAD").await?
        {
            let original_head =
                git_ref(self.status.git(), &location.destination, "ORIG_HEAD").await?;
            if intent.action != "merge"
                || merge_head != intent.source_commit
                || original_head.as_deref() != Some(intent.destination_commit.as_str())
                || destination_head != intent.destination_commit
            {
                return Err(WorktreeChangesError::merge_blocked(
                    "worktree_merge_operation_mismatch",
                    "The destination has a different Git operation in progress.",
                ));
            }
            let paths = unmerged_paths(self.status.git(), &location.destination).await?;
            return Ok(MergeState::Conflicted(location, paths));
        }
        if merge_preview::in_progress(self.status.git(), &location.destination).await? {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_operation_mismatch",
                "The destination has a different Git operation in progress.",
            ));
        }
        if intent.action == "fast_forward" && destination_head == intent.source_commit {
            return Ok(MergeState::Applied(location));
        }
        let source_in_destination = is_ancestor(
            &self.status,
            &intent.source_commit,
            &destination_head,
            &repository,
        )
        .await?;
        if intent.action == "already_integrated" && source_in_destination {
            return Ok(MergeState::Applied(location));
        }
        if intent.action == "merge" && source_in_destination {
            return Ok(MergeState::Applied(location));
        }
        if !command_git::status(self.status.git(), &location.destination)
            .await?
            .stdout
            .is_empty()
        {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_dirty",
                "The destination checkout must remain clean.",
            ));
        }
        if destination_head != intent.destination_commit {
            return Err(stale("The destination branch changed after preview."));
        }
        if intent.action == "merge" {
            return Ok(MergeState::Ready(location));
        }
        if intent.action != "fast_forward"
            || !is_ancestor(
                &self.status,
                &destination_head,
                &intent.source_commit,
                &repository,
            )
            .await?
        {
            return Err(WorktreeChangesError::merge_blocked(
                "worktree_merge_divergent_history",
                "The branches have diverged. No Git state was changed.",
            ));
        }
        Ok(MergeState::Ready(location))
    }

    async fn perform(&self, claim: &ClaimedOperation) -> WorkspaceOperationOutcome {
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
                        conflict(stale("The source worktree record changed.")),
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
            Err(error) => return self.settled(claim, conflict(error)).await,
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
                Err(error) => return self.settled(claim, conflict(error)).await,
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

    async fn result(
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

struct MergeProbe {
    executor: MergeExecutor,
}

impl MergeProbe {
    fn new(executor: MergeExecutor) -> Self {
        Self { executor }
    }
}

#[async_trait]
impl WorkspaceStateProbe for MergeProbe {
    async fn observe(&self, subject: OperationSubject) -> ExternalObservation {
        if subject.kind != WorkspaceOperationKind::WorktreeMerge {
            return ExternalObservation::Uncertain {
                detail: "This probe observes worktree merges only.".to_owned(),
            };
        }
        let Some(intent) = MergeIntent::decode(&subject.payload) else {
            return ExternalObservation::Uncertain {
                detail: "The prepared merge cannot be decoded by this build.".to_owned(),
            };
        };
        let row = match worktree::Entity::find_by_id(&intent.worktree_id)
            .one(self.executor.status.work_items())
            .await
        {
            Ok(Some(row)) => row,
            Ok(None) => {
                return ExternalObservation::Conflicting {
                    code: "worktree_merge_preview_stale".to_owned(),
                    detail: "The source worktree record changed.".to_owned(),
                }
            }
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        };
        let repository = match repository::recorded_repository(&row.repo_root) {
            Ok(repository) => repository,
            Err(error) => {
                return ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
        };
        let _guard = self
            .executor
            .status
            .repository_locks()
            .acquire(&repository)
            .await;
        match self.executor.inspect(&intent, false).await {
            Ok(MergeState::Applied(_)) => ExternalObservation::Applied {
                evidence: json!({
                    "sourceCommit": intent.source_commit,
                    "destinationBranch": intent.destination_branch,
                }),
            },
            Ok(MergeState::Conflicted(_, paths)) => ExternalObservation::Conflicting {
                code: "worktree_merge_conflicted".to_owned(),
                detail: format!("The merge has {} unresolved path(s).", paths.len()),
            },
            Ok(MergeState::Ready(_)) => ExternalObservation::Absent,
            Err(error) if error.code_str() == "worktree_changes_git_unavailable" => {
                ExternalObservation::Uncertain {
                    detail: error.to_string(),
                }
            }
            Err(error) => ExternalObservation::Conflicting {
                code: error.code_str().to_owned(),
                detail: error.to_string(),
            },
        }
    }
}

async fn is_ancestor(
    status: &WorktreeStatusService,
    ancestor: &str,
    descendant: &str,
    repository: &std::path::Path,
) -> Result<bool, WorktreeChangesError> {
    Ok(status
        .git()
        .run(
            &["merge-base", "--is-ancestor", ancestor, descendant],
            repository,
        )
        .await?
        .succeeded)
}

async fn git_ref(
    git: &status::GitPort,
    checkout: &std::path::Path,
    name: &str,
) -> Result<Option<String>, WorktreeChangesError> {
    let outcome = git
        .run(&["rev-parse", "--verify", "--quiet", name], checkout)
        .await?;
    Ok(outcome
        .succeeded
        .then(|| outcome.trimmed_stdout().to_owned()))
}

async fn unmerged_paths(
    git: &status::GitPort,
    checkout: &std::path::Path,
) -> Result<Vec<String>, WorktreeChangesError> {
    let outcome = git
        .run(&["diff", "--name-only", "--diff-filter=U", "-z"], checkout)
        .await?;
    if !outcome.succeeded || outcome.stdout_truncated || !outcome.stdout_valid_utf8 {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not list the merge's unresolved paths.",
        ));
    }
    Ok(outcome
        .stdout
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .collect())
}

fn stale(message: impl Into<String>) -> WorktreeChangesError {
    WorktreeChangesError::merge_blocked("worktree_merge_preview_stale", message)
}

fn conflict(error: WorktreeChangesError) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: error.code_str().to_owned(),
        message: error.to_string(),
        evidence: json!({ "blocked": true }),
    }
}

fn merge_conflict_outcome(
    location: MergeLocation,
    paths: Vec<String>,
) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Conflicted {
        code: "worktree_merge_conflicted".to_owned(),
        message: "The merge has conflicts that require resolution.".to_owned(),
        evidence: json!({
            "destinationCheckout": location.destination,
            "unmergedPaths": paths,
        }),
    }
}

fn failure(error: WorktreeChangesError) -> WorkspaceOperationOutcome {
    failed(error.code_str(), error.to_string())
}

fn failed(code: &str, message: impl Into<String>) -> WorkspaceOperationOutcome {
    WorkspaceOperationOutcome::Failed {
        code: code.to_owned(),
        message: message.into(),
        retryable: true,
        cleanup_confirmed: true,
    }
}

fn outcome_name(intent: &MergeIntent) -> &'static str {
    match intent.action.as_str() {
        "fast_forward" => "fast_forwarded",
        "merge" => "merged",
        _ => "already_integrated",
    }
}

fn result(
    operation_id: &str,
    intent: &MergeIntent,
    outcome: &str,
    location: MergeLocation,
    unmerged_paths: Vec<WorktreeMergePath>,
) -> WorktreeMergeResult {
    WorktreeMergeResult {
        operation_id: operation_id.to_owned(),
        outcome: outcome.to_owned(),
        source_branch: intent.source_branch.clone(),
        source_commit: intent.source_commit.clone(),
        destination_branch: intent.destination_branch.clone(),
        destination_commit: location.destination_head,
        destination_checkout: location.destination.display().to_string(),
        unmerged_paths,
        blocker: None,
        reason: None,
    }
}

fn lease_owner() -> String {
    format!("worktree-merge-{}", uuid::Uuid::new_v4().simple())
}

fn merge_error_code(code: &str) -> &'static str {
    match code {
        "worktree_merge_preview_stale" => "worktree_merge_preview_stale",
        "worktree_merge_dirty" => "worktree_merge_dirty",
        "worktree_merge_operation_in_progress" => "worktree_merge_operation_in_progress",
        "worktree_merge_divergent_history" => "worktree_merge_divergent_history",
        "worktree_merge_git_failed" => "worktree_merge_git_failed",
        _ => "worktree_merge_failed",
    }
}
