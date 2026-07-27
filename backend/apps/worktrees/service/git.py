from __future__ import annotations

import os
import subprocess
from typing import Optional


def _git(
    args: list[str],
    cwd: str,
    *,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run ``git -C <cwd> <args>``, capturing text output."""

    return subprocess.run(
        ["git", "-C", cwd, *args],
        capture_output=True,
        text=True,
        check=check,
    )


def discover_repo(working_path: str) -> Optional[str]:
    """Find the git repo enclosing ``working_path``.

    Returns the repo toplevel, or ``None`` when there is no enclosing repo or
    the path does not exist — a non-zero git exit here is *data*, not an error.
    """

    if not working_path:
        return None
    probe = working_path if os.path.isdir(working_path) else os.path.dirname(working_path)
    if not probe or not os.path.isdir(probe):
        return None
    try:
        res = _git(["rev-parse", "--show-toplevel"], probe, check=False)
    except (FileNotFoundError, NotADirectoryError):
        return None
    if res.returncode != 0:
        return None
    return res.stdout.strip() or None


def _known_worktree_paths(repo_root: str) -> set[str]:
    """Paths git currently tracks as worktrees of ``repo_root``."""

    res = _git(["worktree", "list", "--porcelain"], repo_root, check=False)
    if res.returncode != 0:
        return set()
    paths = set()
    for line in res.stdout.splitlines():
        if line.startswith("worktree "):
            paths.add(os.path.normpath(line[len("worktree "):].strip()))
    return paths
