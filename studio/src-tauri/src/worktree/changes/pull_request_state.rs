//! Live provider state for the one mapped task-worktree pull request.

use seaography::CustomOutputType;
use serde::Serialize;

use super::github::GithubPullRequest;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, CustomOutputType)]
pub struct PullRequestStatusView {
    pub url: Option<String>,
    pub state: String,
    pub target_branch: Option<String>,
    pub head_commit: Option<String>,
    pub integrated: bool,
    pub post_merge_work: bool,
    pub replacement_eligible: bool,
    pub follow_up_eligible: bool,
    pub merge_preparation_eligible: bool,
    pub reason: Option<String>,
}

impl PullRequestStatusView {
    pub(super) fn none() -> Self {
        Self {
            url: None,
            state: "none".to_owned(),
            target_branch: None,
            head_commit: None,
            integrated: false,
            post_merge_work: false,
            replacement_eligible: false,
            follow_up_eligible: false,
            merge_preparation_eligible: false,
            reason: None,
        }
    }

    pub(super) fn unavailable(url: String) -> Self {
        Self {
            url: Some(url),
            state: "unavailable".to_owned(),
            target_branch: None,
            head_commit: None,
            integrated: false,
            post_merge_work: false,
            replacement_eligible: false,
            follow_up_eligible: false,
            merge_preparation_eligible: false,
            reason: Some("GitHub pull-request status is unavailable.".to_owned()),
        }
    }

    pub(crate) fn available(
        url: String,
        provider: GithubPullRequest,
        recorded_base_branch: &str,
        checkout_head: &str,
    ) -> Self {
        let mut view = Self {
            url: Some(url),
            state: String::new(),
            target_branch: Some(provider.base_branch),
            head_commit: Some(provider.head_commit),
            integrated: false,
            post_merge_work: false,
            replacement_eligible: false,
            follow_up_eligible: false,
            merge_preparation_eligible: false,
            reason: None,
        };
        if provider.state == "CLOSED" {
            view.state = "closed_unmerged".to_owned();
            view.replacement_eligible = true;
            return view;
        }
        if view.target_branch.as_deref() != Some(recorded_base_branch) {
            view.state = "wrong_base".to_owned();
            return view;
        }
        match provider.state.as_str() {
            "MERGED" => {
                view.state = "merged".to_owned();
                view.integrated = true;
                view.post_merge_work = view.head_commit.as_deref() != Some(checkout_head);
                view.follow_up_eligible = view.post_merge_work;
            }
            "OPEN" if provider.mergeable == "CONFLICTING" => {
                view.state = "merge_conflict".to_owned();
                view.merge_preparation_eligible = true;
            }
            "OPEN"
                if provider
                    .required_check_buckets
                    .iter()
                    .any(|bucket| matches!(bucket.as_str(), "fail" | "cancel")) =>
            {
                view.state = "checks_failed".to_owned();
                view.merge_preparation_eligible = true;
            }
            "OPEN"
                if provider
                    .required_check_buckets
                    .iter()
                    .any(|bucket| bucket == "pending") =>
            {
                view.state = "checks_pending".to_owned();
            }
            "OPEN"
                if matches!(
                    provider.review_decision.as_deref(),
                    Some("REVIEW_REQUIRED" | "CHANGES_REQUESTED")
                ) =>
            {
                view.state = "approval_required".to_owned();
            }
            "OPEN" if provider.mergeable == "UNKNOWN" => {
                view.state = "mergeability_pending".to_owned();
            }
            "OPEN" => view.state = "ready".to_owned(),
            _ => unreachable!("validated GitHub pull-request state"),
        }
        view
    }
}
