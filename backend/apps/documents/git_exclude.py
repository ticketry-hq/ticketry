"""Keep generated document directories local to a Git checkout."""

from __future__ import annotations

import subprocess
from pathlib import Path


def exclude_directory(repo_path: Path, directory: Path) -> bool:
    """Add a checkout-relative directory to Git's local exclude file.

    Returns ``False`` when ``repo_path`` is not inside a Git worktree or when
    the local exclude file cannot be updated. Generated documents must remain
    usable even when Git is unavailable or the repository metadata is
    read-only.
    """

    try:
        worktree_root = _git_path(repo_path, "--show-toplevel")
        exclude_file = _git_path(
            repo_path,
            "--path-format=absolute",
            "--git-path",
            "info/exclude",
        )
        relative_directory = directory.resolve().relative_to(worktree_root)
        rule = f"/{relative_directory.as_posix().rstrip('/')}/"
        _append_rule(exclude_file, rule)
    except (OSError, subprocess.SubprocessError, ValueError):
        return False
    return True


def _git_path(repo_path: Path, *args: str) -> Path:
    completed = subprocess.run(
        ["git", "-C", str(repo_path), "rev-parse", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    value = completed.stdout.strip()
    if not value:
        raise ValueError("git returned an empty path")
    return Path(value).resolve()


def _append_rule(exclude_file: Path, rule: str) -> None:
    current = exclude_file.read_text(encoding="utf-8") if exclude_file.exists() else ""
    if rule in current.splitlines():
        return
    separator = "" if not current or current.endswith("\n") else "\n"
    exclude_file.parent.mkdir(parents=True, exist_ok=True)
    with exclude_file.open("a", encoding="utf-8") as stream:
        stream.write(f"{separator}{rule}\n")
