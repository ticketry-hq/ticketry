"""Count commits that exist only on a checkout's local branch.

The Changes read stays local. Remote-tracking refs record the last provider
state git fetched or pushed, so comparing HEAD with the refs for the current
branch does not add a network call to opening the Changes tab.
"""

from __future__ import annotations

from apps.source_control.clients.git_cli import run_git

_REF_OUTPUT_LIMIT_BYTES = 32 * 1024


def count_unpushed_commits(repo_path: str, branch: str) -> int:
    """Return commits in HEAD that no matching remote-tracking ref contains."""

    if not branch:
        return 0

    refs = run_git(
        ["for-each-ref", "--format=%(refname)", "refs/remotes"],
        cwd=repo_path,
        operation="this checkout's remote-tracking branches",
        output_limit_bytes=_REF_OUTPUT_LIMIT_BYTES,
    ).stdout.splitlines()
    branch_suffix = f"/{branch}"
    matching_refs = [
        ref.strip()
        for ref in refs
        if ref.strip().startswith("refs/remotes/")
        and ref.strip().endswith(branch_suffix)
    ]
    if not matching_refs:
        return 0

    counted = run_git(
        ["rev-list", "--count", "HEAD", "--not", *matching_refs],
        cwd=repo_path,
        operation="this checkout's unpushed commits",
        output_limit_bytes=4096,
    ).stdout.strip()
    return int(counted) if counted.isdigit() else 0
