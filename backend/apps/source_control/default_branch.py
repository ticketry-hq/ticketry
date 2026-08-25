"""Which branch a pull request would merge into, and which one it may not open from.

Two questions, one resolution, because they have to agree: the branch a pull
request targets is the repository's default branch (or the branch this worktree
was actually cut from), and the branch it may *not* be opened from is that same
branch. Resolving them separately is how a surface ends up refusing a pull
request from ``main`` while targeting ``master``.

Nothing here asks the provider. ``gh repo view`` would answer authoritatively,
but it would make a precondition depend on a GitHub API call and on being
logged in — so a user with no ``gh`` login would be told the wrong thing about
their own branch. Git already knows: the remote's ``HEAD`` is the default
branch, recorded locally by clone and readable from the remote with one probe.
"""

from __future__ import annotations

from apps.source_control.git_cli import run_git
from apps.source_control.remote_branch import REMOTE_PROBE_TIMEOUT_SECONDS


#: The branch assumed when nothing on this machine or the remote says otherwise.
#: Git's own modern default, and the last resort rather than the first guess.
LAST_RESORT_BRANCH = "main"

#: One ref name, never a payload.
_REF_OUTPUT_LIMIT_BYTES = 4096


def default_branch(repo_path: str, *, remote: str) -> str:
    """The repository's default branch, from the cheapest source that knows.

    The locally recorded ``refs/remotes/<remote>/HEAD`` first, because a clone
    writes it and reading it costs nothing. Then one ``ls-remote --symref``,
    which asks the remote itself — the authoritative answer, and the reason a
    checkout that was never cloned (a worktree cut from a repository whose
    remote was added by hand) still gets the right branch.
    """

    recorded = _recorded_head(repo_path, remote=remote)
    if recorded:
        return recorded
    probed = _probed_head(repo_path, remote=remote)
    return probed or LAST_RESORT_BRANCH


def base_branch_for_pull_request(
    repo_path: str, *, remote: str, recorded_base: str
) -> str:
    """The branch a pull request from this checkout should merge into.

    The worktrees engine records what each worktree was cut from, and that is
    the more truthful target when it is not the default branch — a worktree cut
    from a release branch is reviewed against that branch, not against
    ``main``. It is trusted only if it still resolves to a ref, so a base
    branch that has since been deleted falls back to the repository's default
    rather than producing a pull request GitHub would reject.
    """

    if recorded_base and _resolves(repo_path, remote=remote, branch=recorded_base):
        return recorded_base
    return default_branch(repo_path, remote=remote)


def _recorded_head(repo_path: str, *, remote: str) -> str:
    """``refs/remotes/<remote>/HEAD`` as a bare branch name, or ``""``."""

    resolved = run_git(
        ["symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD"],
        cwd=repo_path,
        operation="this repository's default branch",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        # 1 is how ``--quiet`` says the ref is not a symbolic ref, which is the
        # ordinary state of a repository whose remote was added by hand.
        allowed_exit_codes=(0, 1),
    ).stdout.strip()
    prefix = f"{remote}/"
    return resolved[len(prefix) :] if resolved.startswith(prefix) else ""


def _probed_head(repo_path: str, *, remote: str) -> str:
    """The remote's own ``HEAD`` target, read with one probe and no fetch."""

    listed = run_git(
        ["ls-remote", "--symref", remote, "HEAD"],
        cwd=repo_path,
        operation=f"the default branch on {remote}",
        timeout_seconds=REMOTE_PROBE_TIMEOUT_SECONDS,
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        # A remote that is unreachable is not a reason to fail a precondition
        # read; the caller falls back rather than erroring on a network blip.
        allowed_exit_codes=(0, 2, 128),
    ).stdout
    for line in listed.splitlines():
        if not line.startswith("ref:"):
            continue
        ref, _, pointer = line[len("ref:") :].strip().partition("\t")
        if pointer.strip() == "HEAD" and ref.startswith("refs/heads/"):
            return ref[len("refs/heads/") :]
    return ""


def _resolves(repo_path: str, *, remote: str, branch: str) -> bool:
    """True when ``branch`` still names a ref this checkout can see."""

    for candidate in (f"refs/remotes/{remote}/{branch}", f"refs/heads/{branch}"):
        found = run_git(
            ["rev-parse", "--verify", "--quiet", candidate],
            cwd=repo_path,
            operation="a base branch reference",
            output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
            allowed_exit_codes=(0, 1),
        ).stdout.strip()
        if found:
            return True
    return False
