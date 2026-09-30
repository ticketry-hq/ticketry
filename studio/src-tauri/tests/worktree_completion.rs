//! Work Item completion must leave its worktree alone.
//!
//! Every case completes the owning Work Item through the public
//! update_work_item mutation, then composes a fresh GraphQL backend over the
//! same installation. The final case proves the retained checkout remains
//! readable and can still be removed through the explicit discard mutation.

#[path = "common/worktree_completion_git.rs"]
mod git_fixture;
#[path = "common/worktree_completion_support.rs"]
mod support;

use git_fixture::{Scenario, BRANCH};
use support::{assert_completion_preserves, fixture};

#[tokio::test]
async fn completion_preserves_a_clean_worktree() {
    assert_completion_preserves(Scenario::Clean).await;
}

#[tokio::test]
async fn completion_preserves_a_dirty_worktree() {
    assert_completion_preserves(Scenario::Dirty).await;
}

#[tokio::test]
async fn completion_preserves_an_ahead_and_diverged_worktree() {
    assert_completion_preserves(Scenario::Diverged).await;
}

#[tokio::test]
async fn completion_preserves_an_unresolved_conflict() {
    assert_completion_preserves(Scenario::Conflict).await;
}

#[tokio::test]
async fn a_completed_worktree_remains_readable_and_can_be_explicitly_discarded() {
    let mut fixture = fixture(Scenario::Clean).await;
    fixture.complete().await;
    fixture.restart().await;

    let status = fixture.status().await;
    assert_eq!(status["kind"], "worktree");
    assert_eq!(status["checkout_present"], true);
    assert_eq!(
        status["path"],
        fixture.checkout_path().display().to_string()
    );
    assert!(fixture.checkout_is_openable());
    assert_eq!(fixture.read_checkout("README.md"), "base\n");

    let discarded = fixture.discard().await;
    assert_eq!(discarded["removed"], true);
    assert_eq!(discarded["branch"], BRANCH);
    assert_eq!(discarded["status"]["kind"], "none");
    assert_eq!(
        discarded["status"]["checkout_present"],
        serde_json::Value::Null
    );
    assert!(!fixture.checkout_path().exists());
    assert!(!fixture.row_exists().await);
    assert!(!fixture.branch_exists());
}
