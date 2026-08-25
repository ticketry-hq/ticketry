"""Application operations for reviewing a checkout's changes (#980, #981).

Two read-only operations per checkout kind: list what the checkout changed,
and show the working-tree diff for one of those files. A task worktree and a
module base checkout each get their own entry point rather than one call with
a mode flag, so the checkout under review is fixed by which function ran and
can never be swapped by a stray identifier. Both are transport-independent
synchronous code the host's DRF adapters call; neither accepts a filesystem
path, and neither mutates the checkout.

Absence is data, not a failure: a task with no worktree returns
``kind="no_worktree"`` and a module with no readable folder returns
``kind="no_checkout"``, so the tab can explain itself instead of rendering an
error.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from apps.source_control.change_status import ChangedFile, collect_changes
from apps.source_control.checkout import (
    MODULE,
    WORKTREE,
    ModuleCheckout,
    NoCheckout,
    TaskCheckout,
    resolve_module_checkout,
    resolve_task_checkout,
)
from apps.source_control.errors import FileNotChanged
from apps.source_control.file_diff import FileDiff, read_file_diff
from apps.source_control.pull_request_verdict import (
    PullRequestVerdict,
    read_pull_request_verdict,
)
from apps.source_control.unpushed_commits import count_unpushed_commits


@dataclass(frozen=True)
class ChangedFileOut:
    path: str
    status: str
    original_path: Optional[str] = None
    binary: bool = False
    insertions: Optional[int] = None
    deletions: Optional[int] = None


@dataclass(frozen=True)
class WorktreeChangesOut:
    """One checkout's change set.

    ``checkout`` names which kind of checkout answered, and only that kind's
    identifiers are populated. ``kind`` discriminates presence:
    ``changes`` | ``no_worktree`` | ``no_checkout``.
    """

    kind: str
    checkout: str
    task_id: Optional[str] = None
    top_level_task_id: Optional[str] = None
    module_id: Optional[str] = None
    path: Optional[str] = None
    branch: Optional[str] = None
    base_branch: Optional[str] = None
    dirty: bool = False
    file_count: int = 0
    unpushed_commit_count: int = 0
    insertions: int = 0
    deletions: int = 0
    files: tuple[ChangedFileOut, ...] = ()
    reason: Optional[str] = None
    pull_request: Optional[PullRequestVerdict] = None


@dataclass(frozen=True)
class FileDiffOut:
    path: str
    status: str
    binary: bool
    patch: str
    truncated: bool


def _presented(changed: ChangedFile) -> ChangedFileOut:
    return ChangedFileOut(
        path=changed.path,
        status=changed.status,
        original_path=changed.original_path,
        binary=changed.binary,
        insertions=changed.insertions,
        deletions=changed.deletions,
    )


def _collected(
    resolved: TaskCheckout | ModuleCheckout, **identity
) -> WorktreeChangesOut:
    """The change set for a resolved checkout, under its own identity."""

    changes = collect_changes(resolved.path)
    return WorktreeChangesOut(
        kind="changes",
        path=resolved.path,
        dirty=changes.dirty,
        file_count=len(changes.files),
        insertions=changes.insertions,
        deletions=changes.deletions,
        files=tuple(_presented(changed) for changed in changes.files),
        **identity,
    )


def _changed_file(path_on_disk: str, path: str) -> ChangedFile:
    """The change set's entry for ``path``, or a refusal to read it.

    This is the access bound for diffs: only a path the checkout is currently
    changing can be read, so neither endpoint can be turned into a file reader
    for the rest of the checkout — let alone anything outside it.
    """

    for changed in collect_changes(path_on_disk).files:
        if changed.path == path:
            return changed
    raise FileNotChanged()


def _diffed(resolved: TaskCheckout | ModuleCheckout, path: str) -> FileDiffOut:
    diff: FileDiff = read_file_diff(
        resolved.path, _changed_file(resolved.path, path)
    )
    return FileDiffOut(
        path=diff.path,
        status=diff.status,
        binary=diff.binary,
        patch=diff.patch,
        truncated=diff.truncated,
    )


def get_worktree_changes(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> WorktreeChangesOut:
    """Everything the task's worktree changes against HEAD, fetched on demand."""

    checkout = resolve_task_checkout(
        task_id, parent_id=parent_id, module_id=module_id
    )
    if isinstance(checkout, NoCheckout):
        return WorktreeChangesOut(
            kind="no_worktree",
            checkout=WORKTREE,
            task_id=checkout.task_id,
            top_level_task_id=checkout.top_level_task_id,
            reason=checkout.reason,
        )
    return _collected(
        checkout,
        checkout=WORKTREE,
        task_id=checkout.task_id,
        top_level_task_id=checkout.top_level_task_id,
        branch=checkout.branch,
        base_branch=checkout.base_branch,
        unpushed_commit_count=count_unpushed_commits(
            checkout.path, checkout.branch
        ),
        pull_request=read_pull_request_verdict(
            task_id=checkout.top_level_task_id,
            checkout_path=checkout.path,
        ),
    )


def get_worktree_file_diff(
    task_id: str,
    path: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> FileDiffOut:
    """The working-tree diff for one changed file in the task's worktree."""

    checkout = resolve_task_checkout(
        task_id, parent_id=parent_id, module_id=module_id
    )
    if isinstance(checkout, NoCheckout):
        raise FileNotChanged()
    return _diffed(checkout, path)


def get_module_changes(module_id: str) -> WorktreeChangesOut:
    """Everything the module's base checkout changes against HEAD."""

    checkout = resolve_module_checkout(module_id)
    if isinstance(checkout, NoCheckout):
        return WorktreeChangesOut(
            kind="no_checkout",
            checkout=MODULE,
            module_id=checkout.module_id,
            reason=checkout.reason,
        )
    return _collected(
        checkout,
        checkout=MODULE,
        module_id=checkout.module_id,
        branch=checkout.branch or None,
    )


def get_module_file_diff(module_id: str, path: str) -> FileDiffOut:
    """The working-tree diff for one changed file in the module's checkout."""

    checkout = resolve_module_checkout(module_id)
    if isinstance(checkout, NoCheckout):
        raise FileNotChanged()
    return _diffed(checkout, path)
