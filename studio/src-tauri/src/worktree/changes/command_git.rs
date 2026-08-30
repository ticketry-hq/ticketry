use std::path::Path;

use crate::worktree::status::{GitOutcome, GitPort};

use super::WorktreeChangesError;

pub(super) struct RepositoryFacts {
    pub(super) head_commit: String,
    pub(super) dirty: bool,
    pub(super) unpushed_count: i32,
    upstream: Option<String>,
}

pub(super) async fn committed_count(
    git: &GitPort,
    checkout: &Path,
    base: &str,
) -> Result<i32, WorktreeChangesError> {
    count(git, checkout, &format!("{base}..HEAD")).await
}

pub(super) async fn facts(
    git: &GitPort,
    checkout: &Path,
    fallback_base: Option<&str>,
) -> Result<RepositoryFacts, WorktreeChangesError> {
    let status = git
        .run(
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            checkout,
        )
        .await?;
    if !status.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not read the checkout.",
        ));
    }
    let head = git
        .run(&["rev-parse", "--verify", "HEAD^{commit}"], checkout)
        .await?;
    let head_commit = text(&head, "Git could not read the checkout head.")?;
    let upstream = git
        .run(
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
            checkout,
        )
        .await?;
    let upstream = upstream
        .succeeded
        .then(|| text(&upstream, "Git returned an invalid upstream branch."))
        .transpose()?;
    let comparison = upstream.as_deref().or(fallback_base);
    let unpushed_count = match comparison {
        Some(comparison) => count(git, checkout, &format!("{comparison}..HEAD")).await?,
        None => 0,
    };
    Ok(RepositoryFacts {
        head_commit,
        dirty: !status.stdout.is_empty(),
        unpushed_count,
        upstream,
    })
}

pub(super) async fn commit(
    git: &GitPort,
    checkout: &Path,
    message: &str,
) -> Result<(), WorktreeChangesError> {
    let staged = git.run(&["add", "--all", "--"], checkout).await?;
    if !staged.succeeded {
        return Err(WorktreeChangesError::git_command_failed(
            "worktree_commit_git_failed",
            "Git could not stage the uncommitted work.",
            staged.trimmed_stderr(),
        ));
    }
    let committed = git.run(&["commit", "--message", message], checkout).await?;
    if committed.succeeded {
        return Ok(());
    }
    let diagnostic = committed.trimmed_stderr();
    let lower = diagnostic.to_ascii_lowercase();
    if lower.contains("author identity unknown")
        || lower.contains("unable to auto-detect email address")
    {
        return Err(WorktreeChangesError::git_command_failed(
            "worktree_commit_identity_missing",
            "Git needs an author name and email before it can commit.",
            diagnostic,
        ));
    }
    Err(WorktreeChangesError::git_command_failed(
        "worktree_commit_git_failed",
        "Git could not create the commit.",
        diagnostic,
    ))
}

pub(super) async fn push(
    git: &GitPort,
    checkout: &Path,
    facts: &RepositoryFacts,
) -> Result<(), WorktreeChangesError> {
    let outcome = if facts.upstream.is_some() {
        git.run(&["push", "--porcelain"], checkout).await?
    } else {
        let remote = push_remote(git, checkout).await?;
        git.run(
            &["push", "--porcelain", "--set-upstream", &remote, "HEAD"],
            checkout,
        )
        .await?
    };
    if outcome.succeeded {
        return Ok(());
    }
    Err(push_failure(&outcome))
}

async fn push_remote(git: &GitPort, checkout: &Path) -> Result<String, WorktreeChangesError> {
    let remotes = git.run(&["remote"], checkout).await?;
    if !remotes.succeeded || remotes.stdout_truncated || !remotes.stdout_valid_utf8 {
        return Err(WorktreeChangesError::missing_upstream());
    }
    let names: Vec<&str> = remotes
        .stdout
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect();
    if names.contains(&"origin") {
        return Ok("origin".to_owned());
    }
    match names.as_slice() {
        [only] => Ok((*only).to_owned()),
        _ => Err(WorktreeChangesError::missing_upstream()),
    }
}

fn push_failure(outcome: &GitOutcome) -> WorktreeChangesError {
    let diagnostic = if outcome.trimmed_stderr().is_empty() {
        outcome.trimmed_stdout()
    } else {
        outcome.trimmed_stderr()
    };
    let lower =
        format!("{}\n{}", outcome.trimmed_stdout(), outcome.trimmed_stderr()).to_ascii_lowercase();
    if lower.contains("non-fast-forward") || lower.contains("fetch first") {
        return WorktreeChangesError::git_command_failed(
            "worktree_push_non_fast_forward",
            "The remote branch has work that must be fetched first.",
            diagnostic,
        );
    }
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied")
        || lower.contains("repository not found")
    {
        return WorktreeChangesError::git_command_failed(
            "worktree_push_authentication_failed",
            "Git could not authenticate with the remote.",
            diagnostic,
        );
    }
    WorktreeChangesError::git_command_failed(
        "worktree_push_git_failed",
        "Git could not push the committed work.",
        diagnostic,
    )
}

async fn count(git: &GitPort, checkout: &Path, range: &str) -> Result<i32, WorktreeChangesError> {
    let outcome = git.run(&["rev-list", "--count", range], checkout).await?;
    text(&outcome, "Git could not count the unpushed commits.")?
        .parse()
        .map_err(|_| {
            WorktreeChangesError::git_state_unavailable(
                "Git returned an invalid unpushed commit count.",
            )
        })
}

fn text(outcome: &GitOutcome, message: &'static str) -> Result<String, WorktreeChangesError> {
    if !outcome.succeeded || outcome.stdout_truncated || !outcome.stdout_valid_utf8 {
        return Err(WorktreeChangesError::git_state_unavailable(message));
    }
    let value = outcome.trimmed_stdout();
    if value.is_empty() {
        Err(WorktreeChangesError::git_state_unavailable(message))
    } else {
        Ok(value.to_owned())
    }
}
