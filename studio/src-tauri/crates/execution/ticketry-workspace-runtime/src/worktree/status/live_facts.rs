//! What Git says about a checkout right now.
//!
//! The worktree row is an index, not a report. Clean/dirty, ahead/behind, and
//! unmerged state are read from the checkout on every request, so a status
//! answer can never be a stale column. The row contributes only the durable
//! conflict lifecycle state, which records a merge that stopped inside the
//! checkout and must survive a restart even after the files look settled.

use std::path::Path;

use super::error::WorktreeStatusError;
use super::git::GitPort;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct LiveFacts {
    /// Whether the checkout Git registered still exists and answers. This is
    /// the persistence fact: a row that survived a restart with its checkout
    /// intact reports `true`.
    pub(super) checkout_present: bool,
    pub(super) clean: bool,
    pub(super) dirty: bool,
    pub(super) ahead: i32,
    pub(super) behind: i32,
    pub(super) conflict: bool,
}

impl LiveFacts {
    /// The checkout is gone. Nothing about its contents can be claimed, so no
    /// clean, dirty, or count fact is invented — only the durable conflict
    /// state survives.
    fn absent(recorded_conflict: bool) -> Self {
        Self {
            checkout_present: false,
            clean: false,
            dirty: false,
            ahead: 0,
            behind: 0,
            conflict: recorded_conflict,
        }
    }
}

pub(super) async fn observe(
    git: &GitPort,
    checkout: &Path,
    base_branch: &str,
    recorded_conflict: bool,
) -> Result<LiveFacts, WorktreeStatusError> {
    if !checkout.is_dir() {
        return Ok(LiveFacts::absent(recorded_conflict));
    }

    let porcelain = git.run(&["status", "--porcelain"], checkout).await?;
    if !porcelain.succeeded {
        // The directory exists but Git does not recognise it as a checkout —
        // indistinguishable, for reporting purposes, from an absent one.
        return Ok(LiveFacts::absent(recorded_conflict));
    }
    let dirty = !porcelain.trimmed_stdout().is_empty();

    let (behind, ahead) = divergence(git, checkout, base_branch).await?;

    let unmerged = git
        .run(&["diff", "--name-only", "--diff-filter=U"], checkout)
        .await?;
    let conflict =
        recorded_conflict || (unmerged.succeeded && !unmerged.trimmed_stdout().is_empty());

    Ok(LiveFacts {
        checkout_present: true,
        clean: !dirty,
        dirty,
        ahead,
        behind,
        conflict,
    })
}

/// `(behind, ahead)` relative to the recorded base. A base ref that no longer
/// resolves yields no counts rather than a guess.
async fn divergence(
    git: &GitPort,
    checkout: &Path,
    base_branch: &str,
) -> Result<(i32, i32), WorktreeStatusError> {
    let range = format!("{base_branch}...HEAD");
    let counts = git
        .run(&["rev-list", "--left-right", "--count", &range], checkout)
        .await?;
    if !counts.succeeded {
        return Ok((0, 0));
    }
    let mut parts = counts.trimmed_stdout().split_whitespace();
    // Left is commits on the base that HEAD lacks (behind); right is the
    // reverse (ahead).
    match (
        parts.next().and_then(|value| value.parse().ok()),
        parts.next().and_then(|value| value.parse().ok()),
    ) {
        (Some(behind), Some(ahead)) => Ok((behind, ahead)),
        _ => Ok((0, 0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_missing_checkout_claims_nothing_but_keeps_the_durable_conflict() {
        let directory = tempfile::tempdir().expect("create a scratch directory");

        let facts = observe(
            &GitPort::new(),
            &directory.path().join("removed"),
            "main",
            true,
        )
        .await
        .expect("an absent checkout is data");

        assert_eq!(facts, LiveFacts::absent(true));
        assert!(facts.conflict);
    }
}
