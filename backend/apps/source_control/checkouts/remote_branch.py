"""Where a checkout's branch stands against its remote, without fetching.

Push safety is decided here, and it is decided by *reading* rather than by
writing. One remote probe — ``git ls-remote`` — answers what the remote branch
points at; local ancestry answers whether sending HEAD there would be a
fast-forward. Nothing in this module fetches, merges, rebases, or moves a ref,
so asking "can I push?" can never change what would be pushed.

The probe is deliberately not a fetch. A fetch would write refs into the
checkout as a side effect of a question, and it would pull down objects a
review surface has no use for; ``ls-remote`` reads one line and stops. The
consequence is that a remote commit we have never fetched is not a valid
commit *here* — which is exactly the right answer to "is it an ancestor of
HEAD?", because everything reachable from HEAD is present locally by
definition. An unknown object therefore reads as divergence, not as an error.
"""

from __future__ import annotations

from dataclasses import dataclass

from apps.source_control.clients.git_cli import run_git, run_git_capturing
from apps.source_control.errors import GitFailed

#: Wall-clock budget for the one command here that touches the network.
#: Longer than a local read because it dials a host; still bounded, because a
#: hung remote must not hold a request open.
REMOTE_PROBE_TIMEOUT_SECONDS = 60.0

#: The remote used when the branch has no ``branch.<name>.remote`` of its own.
DEFAULT_REMOTE = "origin"

#: One ref name, never a payload. Kept small on purpose so a tightened diff
#: budget can never truncate a sha into a false verdict.
_REF_OUTPUT_LIMIT_BYTES = 4096
_COMMIT_LIST_OUTPUT_LIMIT_BYTES = 1024 * 1024


@dataclass(frozen=True)
class BranchPosition:
    """What one push of ``branch`` to ``remote`` would do, before doing it."""

    branch: str
    remote: str
    head_sha: str
    #: What the remote's copy of the branch points at; ``None`` when the
    #: remote has no such branch and the push would publish it.
    remote_sha: str | None
    #: True when the remote's commit is already contained in HEAD, so sending
    #: HEAD only adds commits. False is divergence, and the only honest answer
    #: to it is for the user to resolve it in a terminal.
    fast_forward: bool
    #: How many commits this push would publish. Measured against the remote
    #: branch when it exists, and against the base branch when it does not —
    #: an unpublished branch has no remote counterpart to subtract.
    commit_count: int
    #: Full commit identities in oldest-to-newest publication order.
    commit_shas: tuple[str, ...]

    @property
    def up_to_date(self) -> bool:
        """True when the remote already holds exactly what HEAD holds."""

        return self.remote_sha == self.head_sha


def current_branch(repo_path: str) -> str | None:
    """The branch HEAD is on, or ``None`` when HEAD is detached.

    ``symbolic-ref`` is asked rather than the worktrees index: the index
    records the branch a worktree was *cut* on, and a terminal can have
    detached HEAD since. Push preconditions must read the checkout's present
    state, not its recorded intent.
    """

    result = run_git(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        cwd=repo_path,
        operation="this checkout's branch",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        # 1 is how symbolic-ref says "HEAD is not a symbolic ref", which is
        # the detached case and an answer rather than a failure.
        allowed_exit_codes=(0, 1),
    )
    return result.stdout.strip() or None


def head_sha(repo_path: str) -> str | None:
    """HEAD's commit, or ``None`` when the branch has no commit yet."""

    result = run_git(
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        cwd=repo_path,
        operation="this checkout's HEAD",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        allowed_exit_codes=(0, 1),
    )
    return result.stdout.strip() or None


def resolve_remote(repo_path: str, branch: str) -> str | None:
    """The remote ``branch`` pushes to, or ``None`` when there is none.

    The branch's own configured remote wins, so a checkout that pushes
    somewhere other than ``origin`` is honoured. ``origin`` is the fallback
    only when it actually exists — this never invents a destination.
    """

    configured = run_git(
        ["config", "--get", f"branch.{branch}.remote"],
        cwd=repo_path,
        operation="this branch's remote",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        # 1 is "not set", which is the common case for a fresh branch.
        allowed_exit_codes=(0, 1),
    ).stdout.strip()
    if configured:
        return configured

    remotes = run_git(
        ["remote"],
        cwd=repo_path,
        operation="this checkout's remotes",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
    ).stdout.split()
    return DEFAULT_REMOTE if DEFAULT_REMOTE in remotes else None


def read_position(
    repo_path: str,
    *,
    branch: str,
    remote: str,
    head: str,
    base_branch: str = "",
) -> BranchPosition:
    """Probe ``remote`` once and work out what pushing ``branch`` would do."""

    remote_sha = _remote_branch_sha(repo_path, remote=remote, branch=branch)
    fast_forward = remote_sha is None or _is_ancestor(repo_path, remote_sha, head)
    commit_shas = _commits_to_publish(
        repo_path,
        remote=remote,
        remote_sha=remote_sha,
        fast_forward=fast_forward,
        base_branch=base_branch,
    )
    return BranchPosition(
        branch=branch,
        remote=remote,
        head_sha=head,
        remote_sha=remote_sha,
        fast_forward=fast_forward,
        commit_count=len(commit_shas),
        commit_shas=commit_shas,
    )


def _remote_branch_sha(repo_path: str, *, remote: str, branch: str) -> str | None:
    """What ``remote``'s copy of ``branch`` points at, or ``None`` if absent."""

    listed = run_git(
        ["ls-remote", "--heads", remote, f"refs/heads/{branch}"],
        cwd=repo_path,
        operation=f"the {remote} copy of {branch}",
        timeout_seconds=REMOTE_PROBE_TIMEOUT_SECONDS,
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
    ).stdout
    for line in listed.splitlines():
        sha, _, ref = line.partition("\t")
        if ref.strip() == f"refs/heads/{branch}":
            return sha.strip()
    return None


def _is_ancestor(repo_path: str, ancestor: str, descendant: str) -> bool:
    """True when ``ancestor`` is contained in ``descendant``'s history.

    This command answers with its exit code and writes nothing, so the exit is
    judged here rather than by :func:`run_git`. Exit 128 — "not a valid commit
    name" — is a *no*, not a failure: the remote's commit was never fetched, so
    it cannot be part of a history that is entirely present locally. Any other
    non-zero exit is a real failure and must not read as a yes.
    """

    operation = "this branch's position against its remote"
    completion = run_git_capturing(
        ["merge-base", "--is-ancestor", ancestor, descendant],
        cwd=repo_path,
        operation=operation,
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
    )
    if completion.exit_code in (0, 1, 128):
        return completion.exit_code == 0
    raise GitFailed(
        operation=operation,
        exit_code=completion.exit_code,
        stderr_bytes=len(completion.stderr.encode("utf-8", errors="replace")),
    )


def _commits_to_publish(
    repo_path: str,
    *,
    remote: str,
    remote_sha: str | None,
    fast_forward: bool,
    base_branch: str,
) -> tuple[str, ...]:
    """Which commits this push would publish, oldest first.

    Against the remote branch when it exists and HEAD contains it. A diverged
    branch has no answer without fetching, and a branch the remote has never
    seen has no remote counterpart, so both fall back to counting the commits
    this branch added to its base.
    """

    if remote_sha is not None and fast_forward:
        return _rev_list(repo_path, f"{remote_sha}..HEAD")
    base = _base_ref(repo_path, remote=remote, base_branch=base_branch)
    if base is None:
        return _rev_list(repo_path, "HEAD")
    return _rev_list(repo_path, f"{base}..HEAD")


def _base_ref(repo_path: str, *, remote: str, base_branch: str) -> str | None:
    """The ref this branch was cut from, preferring the remote's copy of it."""

    if not base_branch:
        return None
    for candidate in (
        f"refs/remotes/{remote}/{base_branch}",
        f"refs/heads/{base_branch}",
    ):
        if _ref_exists(repo_path, candidate):
            return candidate
    return None


def _ref_exists(repo_path: str, ref: str) -> bool:
    resolved = run_git(
        ["rev-parse", "--verify", "--quiet", ref],
        cwd=repo_path,
        operation="a base branch reference",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
        allowed_exit_codes=(0, 1),
    ).stdout.strip()
    return bool(resolved)


def _rev_list(repo_path: str, spec: str) -> tuple[str, ...]:
    listed = run_git(
        ["rev-list", "--reverse", spec],
        cwd=repo_path,
        operation="this branch's unpublished commits",
        output_limit_bytes=_COMMIT_LIST_OUTPUT_LIMIT_BYTES,
    ).stdout.splitlines()
    return tuple(sha.strip().lower() for sha in listed if sha.strip())
