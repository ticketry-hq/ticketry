"""Application operations for opt-in worktrees (Worktrees W3, #589).

Three thin endpoints that wrap the W1 engine for the Details-tab worktree
block: read live status, opt in by creating a worktree, and discard one.
There is deliberately **no integrate route** — integration is not a browser
action; it fires automatically when a task is marked Done (see
:mod:`worktrees.signals`).

Each operation is transport-independent synchronous code called by the host's
DRF adapters. Django runs the adapter in a threadpool under ASGI, so
the synchronous git engine and ORM are called directly without an
``asyncio.to_thread`` dance.

The working path comes from the typed Module link (the same source W2 uses at
launch); the browser supplies
``module_id`` (to find the folder) and, for create, the task's
``ticket_seq`` + ``task_name`` it already holds — so this app stays free of
any worktracker/repository coupling.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from apps.settings_store.module_links import resolve_module_path
from apps.worktrees import dao, service


logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schemas (mirrored by lib/types.ts WorktreeStatus / DiscardResult)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorktreeStatusOut:
    """Discriminated on ``kind``: worktree | no_repo | none."""

    kind: str
    task_id: str
    top_level_task_id: str
    is_shared: bool = False
    branch: Optional[str] = None
    base_branch: Optional[str] = None
    path: Optional[str] = None
    state: Optional[str] = None
    clean: Optional[bool] = None
    dirty: Optional[bool] = None
    ahead: Optional[int] = None
    behind: Optional[int] = None
    conflict: Optional[bool] = None
    ephemeral: bool = False
    reason: Optional[str] = None


@dataclass(frozen=True)
class DiscardOut:
    removed: bool
    reason: str = ""


# ---------------------------------------------------------------------------
# Folder resolution (typed local persistence, no repository round-trip)
# ---------------------------------------------------------------------------


def _module_folder(module_id: Optional[str]) -> Optional[str]:
    """The local repo folder configured for ``module_id``, if it exists."""

    if not module_id:
        return None
    folder = resolve_module_path(module_id)
    if folder and os.path.isdir(folder):
        return folder
    return None


def _none_or_no_repo(
    *, task_id: str, tlt: str, is_shared: bool, working_path: Optional[str]
) -> WorktreeStatusOut:
    """No record yet: decide between offer-create (``none``) and ``no_repo``."""

    repo_root = service.discover_repo(working_path) if working_path else None
    if repo_root is None:
        return WorktreeStatusOut(
            kind="no_repo",
            task_id=task_id,
            top_level_task_id=tlt,
            is_shared=is_shared,
            reason="no git repository encloses this task's working path",
        )
    return WorktreeStatusOut(
        kind="none",
        task_id=task_id,
        top_level_task_id=tlt,
        is_shared=is_shared,
    )


def _status_payload(
    *, task_id: str, tlt: str, is_shared: bool, working_path: Optional[str]
) -> WorktreeStatusOut:
    """Build the block's data from the record + W1's live ``status()``."""

    record = dao.get_by_task(tlt)
    if record is None:
        return _none_or_no_repo(
            task_id=task_id, tlt=tlt, is_shared=is_shared, working_path=working_path
        )

    live = service.status(tlt)
    if isinstance(live, service.NoWorktree):
        # Row vanished between the two reads — fall back to offer-create.
        return _none_or_no_repo(
            task_id=task_id, tlt=tlt, is_shared=is_shared, working_path=working_path
        )

    return WorktreeStatusOut(
        kind="worktree",
        task_id=task_id,
        top_level_task_id=tlt,
        is_shared=is_shared,
        branch=live.branch,
        base_branch=live.base_branch,
        path=live.path,
        state=live.status,
        clean=live.clean,
        dirty=live.dirty,
        ahead=live.ahead,
        behind=live.behind,
        conflict=live.conflict,
        ephemeral=record.ephemeral,
    )


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------


def get_worktree(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
):
    """Live worktree status for a task. Never 404s — absence is data."""

    tlt = service.top_level_task_id(
        task_id=task_id, parent_id=parent_id, module_id=module_id
    )
    working_path = _module_folder(module_id)
    return _status_payload(
        task_id=task_id,
        tlt=tlt,
        is_shared=tlt != task_id,
        working_path=working_path,
    )


def create_worktree(
    task_id: str,
    *,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
    project_id: Optional[str] = None,
    ticket_seq: Optional[int] = None,
    task_name: Optional[str] = None,
):
    """Opt in: cut a worktree off HEAD for the top-level task. Idempotent."""

    tlt = service.top_level_task_id(
        task_id=task_id, parent_id=parent_id, module_id=module_id
    )
    working_path = _module_folder(module_id)

    if working_path is None:
        # No configured/existing folder → nothing encloses the task.
        return WorktreeStatusOut(
            kind="no_repo",
            task_id=task_id,
            top_level_task_id=tlt,
            is_shared=tlt != task_id,
            reason="no local folder is configured for this module",
        )

    result = service.create(
        task_id=tlt,
        working_path=working_path,
        task_name=task_name,
        ticket_seq=ticket_seq,
        project_id=project_id,
        module_id=module_id,
    )
    if isinstance(result, service.NoWorktree):
        return WorktreeStatusOut(
            kind="no_repo",
            task_id=task_id,
            top_level_task_id=tlt,
            is_shared=tlt != task_id,
            reason=result.reason,
        )

    return _status_payload(
        task_id=task_id,
        tlt=tlt,
        is_shared=tlt != task_id,
        working_path=working_path,
    )


def discard_worktree(
    task_id: str,
    parent_id: Optional[str] = None,
    module_id: Optional[str] = None,
):
    """Remove a worktree without integrating (the UI owns the confirm gate)."""

    tlt = service.top_level_task_id(
        task_id=task_id, parent_id=parent_id, module_id=module_id
    )
    result = service.discard(tlt)
    return DiscardOut(removed=result.removed, reason=result.reason)
