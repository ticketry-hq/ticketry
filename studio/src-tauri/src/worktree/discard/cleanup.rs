//! Revalidated safety facts for confirmed post-merge cleanup.

use sea_orm::EntityTrait;

use crate::worktree::changes::{GithubPort, PullRequestStatusView};
use ticketry_entities::work_management::{issue, state};

use super::{error::WorktreeDiscardError, plan::DiscardPlan};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CleanupExpectation {
    pub(crate) pull_request_url: String,
    pub(crate) head_commit: String,
}

pub(crate) async fn verify(
    database: &sea_orm::DatabaseConnection,
    git: &crate::worktree::status::GitPort,
    plan: &DiscardPlan,
) -> Result<CleanupExpectation, WorktreeDiscardError> {
    let pull_request_url = plan
        .pull_request_url
        .as_ref()
        .ok_or_else(WorktreeDiscardError::cleanup_ineligible)?;
    let status = git
        .run(
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            &plan.checkout,
        )
        .await
        .map_err(|_| WorktreeDiscardError::cleanup_ineligible())?;
    if !status.succeeded || !status.stdout.is_empty() {
        return Err(WorktreeDiscardError::cleanup_ineligible());
    }
    let head = git
        .run(&["rev-parse", "--verify", "HEAD^{commit}"], &plan.checkout)
        .await
        .map_err(|_| WorktreeDiscardError::cleanup_ineligible())?;
    let head_commit = head.trimmed_stdout().to_owned();
    if !head.succeeded || head_commit.is_empty() {
        return Err(WorktreeDiscardError::cleanup_ineligible());
    }
    let provider = GithubPort::new()
        .pull_request(&plan.checkout, pull_request_url)
        .await
        .map_err(|_| WorktreeDiscardError::cleanup_ineligible())?;
    let pull_request = PullRequestStatusView::available(
        pull_request_url.clone(),
        provider,
        &plan.base_ref,
        &head_commit,
    );
    if !pull_request.integrated || pull_request.post_merge_work {
        return Err(WorktreeDiscardError::cleanup_ineligible());
    }

    let work_item = issue::Entity::find_by_id(&plan.top_level_row_id)
        .find_also_related(state::Entity)
        .one(database)
        .await?
        .ok_or_else(WorktreeDiscardError::cleanup_ineligible)?;
    if !work_item
        .1
        .as_ref()
        .is_some_and(|current| current.name == "Done")
    {
        return Err(WorktreeDiscardError::cleanup_ineligible());
    }

    Ok(CleanupExpectation {
        pull_request_url: pull_request_url.clone(),
        head_commit: pull_request
            .head_commit
            .expect("an integrated pull request has a head commit"),
    })
}
