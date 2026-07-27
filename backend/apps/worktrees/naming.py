"""Pure builders for worktree slugs, branch names, and on-disk paths.

Worktrees live *outside* the repo, keyed by repo name + CODIN ticket, so a
single repo can host many isolated task checkouts without polluting itself.
The base directory is :data:`MUXED_WORKTREES_DIR` (env), defaulting to
``~/.config/worktracker-studio/worktrees``; it is read at call time so tests can redirect it.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional


WORKTREES_DIR_ENV = "MUXED_WORKTREES_DIR"


def worktrees_dir() -> Path:
    """Base directory holding every worktree checkout."""

    override = os.environ.get(WORKTREES_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".config" / "worktracker-studio" / "worktrees"


def slug(name: Optional[str]) -> str:
    """Lower-kebab a task name into a filesystem/branch-safe slug."""

    cleaned = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return cleaned[:40] or "task"


def _ticket_token(ticket_seq: Optional[int], slug_value: str) -> str:
    """``CODIN-<seq>-<slug>`` (or ``CODIN-<slug>`` when seq is unknown)."""

    if ticket_seq is None:
        return f"CODIN-{slug_value}"
    return f"CODIN-{ticket_seq}-{slug_value}"


def branch_name(ticket_seq: Optional[int], slug_value: str) -> str:
    """The task branch name: ``wt/CODIN-<seq>-<slug>``."""

    return f"wt/{_ticket_token(ticket_seq, slug_value)}"


def worktree_path(repo_root: str, ticket_seq: Optional[int], slug_value: str) -> str:
    """Absolute checkout path under ``<worktrees_dir>/<repo>/CODIN-<seq>-<slug>``."""

    repo_name = os.path.basename(os.path.normpath(repo_root)) or "repo"
    token = _ticket_token(ticket_seq, slug_value)
    return str(worktrees_dir() / repo_name / token)
