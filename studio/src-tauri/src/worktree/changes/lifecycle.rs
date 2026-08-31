//! Owning-ticket reconciliation and cleanup candidacy for one mapped pull request.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::work_management::commands::workflow::{self, TransitionOrigin, TransitionWorkItem};
use ticketry_entities::work_management::{issue, state};

use super::{
    PullRequestStatusView, WorkItemClosureFailureView, WorktreeChangesService,
    WorktreeCleanupStatusView,
};

pub(super) struct WorktreeLifecycleStatus {
    pub(super) work_item_done: bool,
    pub(super) closure_failure: Option<WorkItemClosureFailureView>,
    pub(super) cleanup: WorktreeCleanupStatusView,
}

impl WorktreeChangesService {
    pub(super) async fn reconcile_lifecycle(
        &self,
        top_level_row_id: &str,
        pull_request: &PullRequestStatusView,
        dirty: bool,
    ) -> WorktreeLifecycleStatus {
        let work_item = issue::Entity::find_by_id(top_level_row_id)
            .find_also_related(state::Entity)
            .one(self.status().work_items())
            .await;
        let Ok(Some((work_item, current_state))) = work_item else {
            return unavailable(
                "work_item_unavailable",
                "The owning Work Item could not be read.",
            );
        };
        let done = state::Entity::find()
            .filter(state::Column::ProjectId.eq(&work_item.project_id))
            .filter(state::Column::Name.eq("Done"))
            .one(self.status().work_items())
            .await;
        let Ok(done) = done else {
            return unavailable(
                "work_item_unavailable",
                "The owning Work Item could not be read.",
            );
        };
        let mut work_item_done = done
            .as_ref()
            .is_some_and(|done| work_item.state_id.as_deref() == Some(done.id.as_str()));
        let mut closure_failure = None;

        if pull_request.integrated && !work_item_done {
            match done {
                Some(done) => {
                    let transition = workflow::transition(
                        self.status().work_items(),
                        TransitionWorkItem {
                            id: work_item.id.clone(),
                            target_state_id: done.id,
                            origin: TransitionOrigin::Agent,
                        },
                        self.work_facts.as_ref(),
                    )
                    .await;
                    match transition {
                        Ok(_) => work_item_done = true,
                        Err(error) => {
                            closure_failure = Some(WorkItemClosureFailureView {
                                code: error.code().to_owned(),
                                message: error.to_string(),
                                from_state: error.from_state().map(str::to_owned).or_else(|| {
                                    current_state.as_ref().map(|state| state.name.clone())
                                }),
                                to_state: error
                                    .to_state()
                                    .map(str::to_owned)
                                    .or_else(|| Some("Done".to_owned())),
                            });
                        }
                    }
                }
                None => {
                    closure_failure = Some(WorkItemClosureFailureView {
                        code: "done_state_unavailable".to_owned(),
                        message: "The workflow has no Done state.".to_owned(),
                        from_state: current_state.map(|state| state.name),
                        to_state: Some("Done".to_owned()),
                    });
                }
            }
        }

        let cleanup = cleanup_status(pull_request, work_item_done, dirty);
        WorktreeLifecycleStatus {
            work_item_done,
            closure_failure,
            cleanup,
        }
    }
}

fn cleanup_status(
    pull_request: &PullRequestStatusView,
    work_item_done: bool,
    dirty: bool,
) -> WorktreeCleanupStatusView {
    if !pull_request.integrated {
        let (blocker, reason) = match pull_request.state.as_str() {
            "none" => (
                "pull_request_absent",
                "No pull request is mapped to this worktree.",
            ),
            "unavailable" => (
                "pull_request_unavailable",
                "Pull-request status is unavailable, so cleanup cannot be verified.",
            ),
            "closed_unmerged" => (
                "pull_request_closed_unmerged",
                "The mapped pull request closed without merging.",
            ),
            "wrong_base" => (
                "pull_request_wrong_base",
                "The mapped pull request did not merge into the recorded base.",
            ),
            _ => (
                "pull_request_not_merged",
                "The mapped pull request has not merged.",
            ),
        };
        return WorktreeCleanupStatusView::blocked(blocker, reason);
    }
    if !work_item_done {
        return WorktreeCleanupStatusView::blocked(
            "work_item_not_done",
            "The owning Work Item must reach Done before cleanup.",
        );
    }
    if dirty {
        return WorktreeCleanupStatusView::blocked(
            "checkout_dirty",
            "Uncommitted work must be resolved before cleanup.",
        );
    }
    if pull_request.post_merge_work {
        return WorktreeCleanupStatusView::blocked(
            "post_merge_work",
            "New branch work exists after the merged pull request.",
        );
    }
    WorktreeCleanupStatusView::eligible()
}

fn unavailable(code: &str, message: &str) -> WorktreeLifecycleStatus {
    WorktreeLifecycleStatus {
        work_item_done: false,
        closure_failure: Some(WorkItemClosureFailureView {
            code: code.to_owned(),
            message: message.to_owned(),
            from_state: None,
            to_state: Some("Done".to_owned()),
        }),
        cleanup: WorktreeCleanupStatusView::blocked(code, message),
    }
}
