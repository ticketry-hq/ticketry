use std::path::Path;

use crate::worktree::status::{GitOutcome, GitPort};

use super::WorktreeChangesError;

pub(super) struct ModuleBaseline {
    pub(super) branch: String,
    pub(super) comparison: String,
    pub(super) kind: &'static str,
    pub(super) commit: String,
    pub(super) unpushed_count: i32,
}

struct DefaultBranch {
    name: String,
    reference: String,
}

pub(super) struct ModulePullRequestTarget {
    pub(super) branch: String,
    pub(super) base_branch: String,
    pub(super) base_reference: String,
}

pub(super) async fn pull_request_target(
    git: &GitPort,
    checkout: &Path,
) -> Result<Option<ModulePullRequestTarget>, WorktreeChangesError> {
    let branch = current_branch(git, checkout).await?;
    if branch.starts_with("detached@") {
        return Ok(None);
    }
    let Some(default) = default_branch(git, checkout, &branch).await? else {
        return Ok(None);
    };
    if branch == default.name {
        return Ok(None);
    }
    Ok(Some(ModulePullRequestTarget {
        branch,
        base_branch: default.name,
        base_reference: default.reference,
    }))
}

pub(super) async fn resolve(
    git: &GitPort,
    checkout: &Path,
) -> Result<Option<ModuleBaseline>, WorktreeChangesError> {
    let head = git
        .run(&["rev-parse", "--verify", "HEAD^{commit}"], checkout)
        .await?;
    if !head.succeeded {
        return Ok(None);
    }
    let head_commit = text(&head, "Git could not read the module checkout head.")?;
    let branch = current_branch(git, checkout).await?;

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
    if upstream.succeeded {
        let comparison = text(&upstream, "Git returned an invalid upstream branch.")?;
        let commit = commit(git, checkout, &comparison).await?;
        let unpushed_count = count(git, checkout, &format!("{commit}..HEAD")).await?;
        return Ok(Some(ModuleBaseline {
            branch,
            comparison,
            kind: "upstream",
            commit,
            unpushed_count,
        }));
    }

    if let Some(default) = default_branch(git, checkout, &branch).await? {
        if branch != default.name {
            let merge_base = git
                .run(&["merge-base", "HEAD", &default.reference], checkout)
                .await?;
            if merge_base.succeeded {
                let commit = text(
                    &merge_base,
                    "Git returned an invalid default-branch merge base.",
                )?;
                let unpushed_count = count(git, checkout, &format!("{commit}..HEAD")).await?;
                return Ok(Some(ModuleBaseline {
                    branch,
                    comparison: default.name,
                    kind: "default_merge_base",
                    commit,
                    unpushed_count,
                }));
            }
        }
    }

    Ok(Some(ModuleBaseline {
        comparison: branch.clone(),
        branch,
        kind: "head",
        commit: head_commit,
        unpushed_count: 0,
    }))
}

async fn current_branch(git: &GitPort, checkout: &Path) -> Result<String, WorktreeChangesError> {
    let branch = git
        .run(&["symbolic-ref", "--quiet", "--short", "HEAD"], checkout)
        .await?;
    if branch.succeeded {
        return text(&branch, "Git returned an invalid branch name.");
    }
    let short = git.run(&["rev-parse", "--short", "HEAD"], checkout).await?;
    Ok(format!(
        "detached@{}",
        text(
            &short,
            "Git could not identify the detached module checkout."
        )?
    ))
}

async fn default_branch(
    git: &GitPort,
    checkout: &Path,
    current: &str,
) -> Result<Option<DefaultBranch>, WorktreeChangesError> {
    let remotes = git.run(&["remote"], checkout).await?;
    if remotes.succeeded {
        let mut names: Vec<&str> = remotes
            .stdout
            .lines()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .collect();
        names.sort_by_key(|name| if *name == "origin" { 0 } else { 1 });
        for remote in names {
            let reference = format!("refs/remotes/{remote}/HEAD");
            let symbolic = git
                .run(
                    &["symbolic-ref", "--quiet", "--short", &reference],
                    checkout,
                )
                .await?;
            if !symbolic.succeeded {
                continue;
            }
            let short = text(&symbolic, "Git returned an invalid default branch.")?;
            let prefix = format!("{remote}/");
            if let Some(name) = short.strip_prefix(&prefix) {
                return Ok(Some(DefaultBranch {
                    name: name.to_owned(),
                    reference: short,
                }));
            }
        }
    }

    for name in ["main", "master"] {
        if resolves(git, checkout, &format!("refs/heads/{name}")).await? {
            return Ok(Some(DefaultBranch {
                name: name.to_owned(),
                reference: name.to_owned(),
            }));
        }
    }
    if !current.starts_with("detached@") && resolves(git, checkout, current).await? {
        return Ok(Some(DefaultBranch {
            name: current.to_owned(),
            reference: current.to_owned(),
        }));
    }
    Ok(None)
}

async fn resolves(
    git: &GitPort,
    checkout: &Path,
    reference: &str,
) -> Result<bool, WorktreeChangesError> {
    Ok(git
        .run(&["rev-parse", "--verify", "--quiet", reference], checkout)
        .await?
        .succeeded)
}

async fn commit(
    git: &GitPort,
    checkout: &Path,
    reference: &str,
) -> Result<String, WorktreeChangesError> {
    let expression = format!("{reference}^{{commit}}");
    let outcome = git
        .run(&["rev-parse", "--verify", &expression], checkout)
        .await?;
    if !outcome.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "The module checkout's configured upstream is unavailable.",
        ));
    }
    text(&outcome, "Git returned an invalid comparison commit.")
}

async fn count(git: &GitPort, checkout: &Path, range: &str) -> Result<i32, WorktreeChangesError> {
    let outcome = git.run(&["rev-list", "--count", range], checkout).await?;
    if !outcome.succeeded {
        return Err(WorktreeChangesError::git_state_unavailable(
            "Git could not count the module checkout's unpushed commits.",
        ));
    }
    text(&outcome, "Git returned an invalid unpushed commit count.")?
        .parse()
        .map_err(|_| {
            WorktreeChangesError::git_state_unavailable(
                "Git returned an invalid unpushed commit count.",
            )
        })
}

fn text(outcome: &GitOutcome, message: &'static str) -> Result<String, WorktreeChangesError> {
    if !outcome.stdout_valid_utf8 || outcome.stdout_truncated {
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

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().expect("create module baseline fixture");
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
        git(&["push", "-u", "origin", "main"], &checkout);
        git(&["remote", "set-head", "origin", "main"], &checkout);
        (directory, checkout)
    }

    #[tokio::test]
    async fn configured_upstream_is_the_module_baseline() {
        let (_directory, checkout) = fixture();
        std::fs::write(checkout.join("ahead.txt"), "ahead\n").expect("write ahead file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "ahead"], &checkout);

        let baseline = resolve(&GitPort::new(), &checkout)
            .await
            .expect("resolve configured upstream")
            .expect("committed checkout");

        assert_eq!(baseline.branch, "main");
        assert_eq!(baseline.comparison, "origin/main");
        assert_eq!(baseline.kind, "upstream");
        assert_eq!(baseline.unpushed_count, 1);
    }

    #[tokio::test]
    async fn unpublished_feature_uses_the_default_branch_merge_base() {
        let (_directory, checkout) = fixture();
        git(&["switch", "-c", "feature/module-changes"], &checkout);
        std::fs::write(checkout.join("feature.txt"), "feature\n").expect("write feature file");
        git(&["add", "."], &checkout);
        git(&["commit", "-m", "feature"], &checkout);

        let baseline = resolve(&GitPort::new(), &checkout)
            .await
            .expect("resolve unpublished feature")
            .expect("committed checkout");

        assert_eq!(baseline.branch, "feature/module-changes");
        assert_eq!(baseline.comparison, "main");
        assert_eq!(baseline.kind, "default_merge_base");
        assert_eq!(baseline.unpushed_count, 1);
    }
}
