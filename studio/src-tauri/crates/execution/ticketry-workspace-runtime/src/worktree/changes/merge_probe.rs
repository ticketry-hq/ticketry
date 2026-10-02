use async_trait::async_trait;
use sea_orm::EntityTrait;
use serde_json::json;
use ticketry_entities::worktree;

use crate::workspace::operations::{
    ExternalObservation, OperationSubject, WorkspaceOperationKind, WorkspaceStateProbe,
};

use super::merge_executor::MergeExecutor;
use super::merge_identity::MergeIntent;
use super::merge_inspection::MergeState;
use super::repository;

pub(super) struct MergeProbe {
    executor: MergeExecutor,
}

impl MergeProbe {
    pub(super) fn new(executor: MergeExecutor) -> Self {
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
            Err(error) => ExternalObservation::Uncertain {
                detail: error.to_string(),
            },
        }
    }
}
