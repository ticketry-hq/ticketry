"""Resolving which checkout a source-control read is allowed to touch.

Access is bounded by construction: the only directories this app will run git
in are the one the worktrees index recorded for a task and the one the host
recorded for a module. Both must still be the top level of a git checkout. A
caller supplies task or module identifiers, never a filesystem path.

The two checkout kinds stay separate types all the way down, so a module read
can never be answered from a worktree and neither can borrow the other's
command, cache entry, or error.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from apps.settings_store.module_links import resolve_module_path
from apps.source_control.git_cli import run_git
from apps.worktrees import dao as worktrees_dao
from apps.worktrees import service as worktrees_service


#: The two checkout kinds this app reads, as they appear on the wire.
WORKTREE = "worktree"
MODULE = "module"


@dataclass(frozen=True)
class TaskCheckout:
    """One task worktree this app may read."""

    task_id: str
    top_level_task_id: str
    path: str
    branch: str
    base_branch: str


@dataclass(frozen=True)
class ModuleCheckout:
    """One module's base checkout on this host.

    It carries no base branch: the base checkout normally *is* the default
    branch, so there is nothing for it to be compared against.
    """

    module_id: str
    path: str
    branch: str


@dataclass(frozen=True)
class NoCheckout:
    """No readable checkout. Absence is data, never a 404."""

    reason: str
    task_id: Optional[str] = None
    top_level_task_id: Optional[str] = None
    module_id: Optional[str] = None


def _is_checkout_top_level(path: str) -> bool:
    """True when ``path`` is itself the top of a git checkout.

    Guards against the recorded directory having been replaced by an ordinary
    folder inside some *other* repository, which would otherwise let a review
    read report a repository the task or module never owned.
    """

    result = run_git(
        ["rev-parse", "--show-toplevel"],
        cwd=path,
        operation="this checkout's location",
        # One path, never a payload — this probe keeps its own small cap so a
        # tightened diff budget can never truncate it into a false mismatch.
        output_limit_bytes=4096,
        allowed_exit_codes=(0, 128),
    )
    toplevel = result.stdout.strip()
    if not toplevel:
        return False
    return os.path.realpath(toplevel) == os.path.realpath(path)


def _current_branch(path: str) -> str:
    """The checked-out branch name, or ``""`` on a detached or unborn HEAD."""

    result = run_git(
        ["branch", "--show-current"],
        cwd=path,
        operation="this checkout's branch",
        output_limit_bytes=4096,
        allowed_exit_codes=(0, 128),
    )
    return result.stdout.strip()


def resolve_task_checkout(
    task_id: str,
    *,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> TaskCheckout | NoCheckout:
    """The worktree owning ``task_id``, or why there is nothing to review."""

    top_level = worktrees_service.top_level_task_id(
        task_id=task_id, parent_id=parent_id, module_id=module_id
    )

    def absent(reason: str) -> NoCheckout:
        return NoCheckout(
            reason=reason, task_id=task_id, top_level_task_id=top_level
        )

    record = worktrees_dao.get_by_task(top_level)
    if record is None:
        return absent("this task has no worktree yet")
    if not record.path or not os.path.isdir(record.path):
        return absent("this task's worktree is no longer on disk")
    if not _is_checkout_top_level(record.path):
        return absent("this task's worktree is no longer a git checkout")
    return TaskCheckout(
        task_id=task_id,
        top_level_task_id=top_level,
        path=record.path,
        branch=record.branch,
        base_branch=record.base_branch,
    )


def resolve_module_checkout(module_id: str) -> ModuleCheckout | NoCheckout:
    """The module's base checkout, or why there is nothing to review.

    The folder comes from the host's module link — the same binding every
    module shell and agent launch already runs in — so a review read cannot
    reach a directory the user never linked.
    """

    def absent(reason: str) -> NoCheckout:
        return NoCheckout(reason=reason, module_id=module_id)

    path = resolve_module_path(module_id)
    if not path:
        return absent("this module has no linked folder on this machine")
    if not os.path.isdir(path):
        return absent("this module's folder is no longer on disk")
    if not _is_checkout_top_level(path):
        return absent("this module's folder is not the top of a git checkout")
    return ModuleCheckout(
        module_id=module_id, path=path, branch=_current_branch(path)
    )


#: Either checkout this app reads or writes. Both carry a path, a branch, and
#: their own identity; only the task worktree carries a recorded base branch.
Checkout = TaskCheckout | ModuleCheckout


def recorded_base_branch(checkout: Checkout) -> str:
    """The branch ``checkout`` was cut from, or ``""`` when nothing recorded one.

    A task worktree carries the base the worktrees engine recorded for it. A
    module base checkout carries none — it normally *is* the default branch —
    and ``""`` is already how the push and pull-request preconditions spell
    "resolve the base from the repository instead", so a module checkout needs
    no special case anywhere downstream.
    """

    return checkout.base_branch if isinstance(checkout, TaskCheckout) else ""
