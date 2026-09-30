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
    let status = status(git, checkout).await?;
    facts_from_status(git, checkout, fallback_base, &status).await
}

pub(super) async fn status(
    git: &GitPort,
    checkout: &Path,
) -> Result<GitOutcome, WorktreeChangesError> {
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
    Ok(status)
}

pub(super) async fn facts_from_status(
    git: &GitPort,
    checkout: &Path,
    fallback_base: Option<&str>,
    status: &GitOutcome,
) -> Result<RepositoryFacts, WorktreeChangesError> {
    let head_commit = head_commit(git, checkout).await?;
    let upstream = remote_tracking_ref(git, checkout).await?;
    let unpushed_count = match upstream.as_deref().or(fallback_base) {
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

/// The exact local remote-tracking ref for this branch, e.g.
/// `origin/feature/deep/task-work`. Resolved from Git's local refs only —
/// no network contact — with the full branch name so slash-containing
/// branches never match a prefix.
async fn remote_tracking_ref(
    git: &GitPort,
    checkout: &Path,
) -> Result<Option<String>, WorktreeChangesError> {
    let branch = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"], checkout)
        .await?;
    let branch = match branch.succeeded {
        true => text(&branch, "Git returned an invalid branch name.")?,
        false => return Ok(None),
    };
    let remote = branch_push_remote(git, checkout, &branch).await?;
    let Some(remote) = remote else {
        return Ok(None);
    };
    let candidate = format!("refs/remotes/{remote}/{branch}");
    let verified = git
        .run(&["rev-parse", "--verify", "--quiet", &candidate], checkout)
        .await?;
    Ok(verified.succeeded.then_some(format!("{remote}/{branch}")))
}

/// The branch-specific remote wins; `origin` is the fallback only when the
/// branch has no configured remote and exactly one remote exists.
async fn branch_push_remote(
    git: &GitPort,
    checkout: &Path,
    branch: &str,
) -> Result<Option<String>, WorktreeChangesError> {
    let configured = git
        .run(
            &["config", "--get", &format!("branch.{branch}.remote")],
            checkout,
        )
        .await?;
    if configured.succeeded {
        let name = text(&configured, "Git returned an invalid branch remote.")?;
        return Ok(Some(name));
    }
    match push_remote(git, checkout).await {
        Ok(remote) => Ok(Some(remote)),
        Err(_) => Ok(None),
    }
}

pub(super) async fn head_commit(
    git: &GitPort,
    checkout: &Path,
) -> Result<String, WorktreeChangesError> {
    let head = git
        .run(&["rev-parse", "--verify", "HEAD^{commit}"], checkout)
        .await?;
    text(&head, "Git could not read the checkout head.")
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
    let branch = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"], checkout)
        .await?;
    let tracked = match branch.succeeded {
        true => {
            git.run(
                &[
                    "config",
                    "--get",
                    &format!(
                        "branch.{}.remote",
                        text(&branch, "Git returned an invalid branch name.")?
                    ),
                ],
                checkout,
            )
            .await?
            .succeeded
        }
        false => false,
    };
    let outcome = if tracked {
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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::*;

    fn git(arguments: &[&str], directory: &Path) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(directory)
            .args(arguments)
            .env("GIT_AUTHOR_NAME", "Ticketry Test")
            .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
            .env("GIT_COMMITTER_NAME", "Ticketry Test")
            .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid")
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn fixture(branch: &str) -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().expect("create remote ref fixture");
        let remote = directory.path().join("remote.git");
        let checkout = directory.path().join("checkout");
        std::fs::create_dir_all(&remote).expect("create remote directory");
        git(&["init", "--bare", "-b", "main"], &remote);
        let output = Command::new("git")
            .args([
                "clone",
                remote.to_str().unwrap(),
                checkout.to_str().unwrap(),
            ])
            .output()
            .expect("clone fixture repository");
        assert!(output.status.success(), "clone failed");
        git(
            &["config", "user.email", "test@ticketry.invalid"],
            &checkout,
        );
        git(&["config", "user.name", "Ticketry Test"], &checkout);
        std::fs::write(checkout.join("base.txt"), "base\n").expect("write base file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "base"], &checkout);
        git(
            &["push", "-u", "origin", &format!("HEAD:{branch}")],
            &checkout,
        );
        git(&["remote", "set-head", "origin", branch], &checkout);
        (directory, checkout)
    }

    #[tokio::test]
    async fn unpushed_commits_compare_against_the_exact_remote_tracking_ref() {
        let (_directory, checkout) = fixture("feature/deep/task-work");
        git(
            &["symbolic-ref", "HEAD", "refs/heads/feature/deep/task-work"],
            &checkout,
        );
        std::fs::write(checkout.join("ahead.txt"), "ahead\n").expect("write ahead file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "ahead"], &checkout);

        // Reading facts must never contact the network: point the remote at
        // an unreachable ssh URL. Any implicit fetch or ls-remote would fail
        // the read; resolving local refs must not.
        git(
            &[
                "remote",
                "set-url",
                "origin",
                "ssh://unreachable.invalid/repo.git",
            ],
            &checkout,
        );

        let facts = facts(&GitPort::new(), &checkout, None)
            .await
            .expect("read slash-branch facts");

        assert_eq!(facts.unpushed_count, 1);
        assert_eq!(
            facts.upstream.as_deref(),
            Some("origin/feature/deep/task-work")
        );
    }

    #[tokio::test]
    async fn a_branch_without_a_remote_tracking_ref_falls_back_to_the_recorded_base() {
        let (_directory, checkout) = fixture("main");
        git(&["switch", "-c", "feature/local-only"], &checkout);
        std::fs::write(checkout.join("ahead.txt"), "ahead\n").expect("write ahead file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "ahead"], &checkout);

        let facts = facts(&GitPort::new(), &checkout, Some("origin/main"))
            .await
            .expect("read fallback facts");

        assert_eq!(facts.unpushed_count, 1);
        assert_eq!(facts.upstream.as_deref(), None);
    }

    #[tokio::test]
    async fn the_branch_specific_push_remote_wins_over_origin() {
        let (_directory, checkout) = fixture("main");
        let remote_dir = _directory.path().join("forks.git");
        std::fs::create_dir_all(&remote_dir).expect("create forks remote");
        git(&["init", "--bare", "-b", "main"], &remote_dir);
        git(
            &[
                "remote",
                "add",
                "forks",
                remote_dir.to_str().expect("remote path"),
            ],
            &checkout,
        );
        git(&["switch", "-c", "fork/topic"], &checkout);
        std::fs::write(checkout.join("ahead.txt"), "ahead\n").expect("write ahead file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "ahead"], &checkout);
        git(&["push", "forks", "HEAD:refs/heads/fork/topic"], &checkout);
        git(&["config", "branch.fork/topic.remote", "forks"], &checkout);
        std::fs::write(checkout.join("extra.txt"), "extra\n").expect("write extra file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "extra"], &checkout);

        let facts = facts(&GitPort::new(), &checkout, None)
            .await
            .expect("read branch-remote facts");

        assert_eq!(facts.upstream.as_deref(), Some("forks/fork/topic"));
        assert_eq!(facts.unpushed_count, 1);
    }

    #[tokio::test]
    async fn a_pushed_once_branch_without_upstream_config_still_pushes() {
        let (_directory, checkout) = fixture("main");
        git(&["switch", "-c", "feature/once"], &checkout);
        std::fs::write(checkout.join("ahead.txt"), "ahead\n").expect("write ahead file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "ahead"], &checkout);
        // An explicit-refspec push creates the remote-tracking ref without
        // branch.<name>.merge upstream config.
        git(
            &["push", "origin", "HEAD:refs/heads/feature/once"],
            &checkout,
        );
        std::fs::write(checkout.join("extra.txt"), "extra\n").expect("write extra file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "extra"], &checkout);

        let facts = facts(&GitPort::new(), &checkout, None)
            .await
            .expect("read facts");
        assert_eq!(facts.upstream.as_deref(), Some("origin/feature/once"));

        push(&GitPort::new(), &checkout, &facts)
            .await
            .expect("push without upstream config must use set-upstream");
    }
}
