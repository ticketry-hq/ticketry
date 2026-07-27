from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class NoWorktree:
    """Returned instead of raising when there is nothing to operate on.

    The two reasons that matter: the working path has no enclosing git repo
    (callers fall back to working in the path directly), or no record exists
    for the task yet.
    """

    reason: str


@dataclass
class WorktreeStatus:
    """Live status of a worktree, computed from git (never persisted)."""

    task_id: str
    path: str
    branch: str
    base_branch: str
    exists: bool
    clean: bool
    dirty: bool
    ahead: int
    behind: int
    conflict: bool
    status: str


@dataclass
class IntegrateResult:
    """Outcome of an :func:`integrate` attempt.

    ``outcome`` is one of: ``integrated`` (clean merge, base fast-forwarded,
    worktree + branch + row gone), ``conflict`` (merge stopped in the worktree,
    row marked conflict, tree intact), ``dirty`` (uncommitted work — commit
    first), ``ephemeral`` (scratch worktrees are discard-only), or
    ``no_worktree`` (no record / tree).
    """

    task_id: str
    outcome: str
    reason: str = ""


@dataclass
class DiscardResult:
    task_id: str
    removed: bool
    reason: str = ""


@dataclass
class ReconcileResult:
    pruned: list[str]
    kept: int
