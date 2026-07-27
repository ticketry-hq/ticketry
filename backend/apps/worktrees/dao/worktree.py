from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import django.db

from apps.worktrees.models import Worktree


def now_iso() -> str:
    """Single ISO-8601 UTC timestamp formatter for the worktrees table."""

    return datetime.now(timezone.utc).isoformat()


def get_by_task(task_id: str) -> Optional[Worktree]:
    """Return the live worktree record for a top-level task, or ``None``.

    Unlike the write helpers, this getter must NOT close connections: it runs
    synchronously inside the ``integrate_on_complete`` post_save handler, which
    fires while the workflow transition's transaction is still open. Closing the
    connection there breaks that transaction — a later write in the same atomic
    (e.g. the ForceTransition audit row on a forced move) hits a closed database.
    Thread-boundary connection cleanup for the integrate path is handled by
    ``_safe_integrate``.
    """

    return Worktree.objects.filter(task_id=task_id).first()


def create(
    *,
    task_id: str,
    repo_root: str,
    path: str,
    branch: str,
    base_branch: str,
    base_commit: str,
    status: str = "active",
    ephemeral: bool = False,
    workspace_slug: Optional[str] = None,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
    ticket_seq: Optional[int] = None,
) -> Worktree:
    """Insert a new worktree row and return it."""

    stamp = now_iso()
    try:
        return Worktree.objects.create(
            id=uuid.uuid4().hex,
            task_id=task_id,
            repo_root=repo_root,
            path=path,
            branch=branch,
            base_branch=base_branch,
            base_commit=base_commit,
            status=status,
            ephemeral=ephemeral,
            workspace_slug=workspace_slug,
            project_id=project_id,
            module_id=module_id,
            ticket_seq=ticket_seq,
            created_at=stamp,
            updated_at=stamp,
        )
    finally:
        django.db.close_old_connections()


def set_status(task_id: str, status: str) -> bool:
    """Update a worktree's coarse lifecycle status; bump ``updated_at``."""

    try:
        updated = Worktree.objects.filter(task_id=task_id).update(
            status=status,
            updated_at=now_iso(),
        )
        return updated > 0
    finally:
        django.db.close_old_connections()


def delete(task_id: str) -> None:
    """Delete a worktree row by top-level task id."""

    try:
        Worktree.objects.filter(task_id=task_id).delete()
    finally:
        django.db.close_old_connections()


def list_by_scope(
    *,
    project_id: Optional[str] = None,
    module_id: Optional[str] = None,
) -> list[Worktree]:
    """Return worktree records, optionally scoped to a project/module."""

    try:
        rows = Worktree.objects.all()
        if project_id is not None:
            rows = rows.filter(project_id=project_id)
        if module_id is not None:
            rows = rows.filter(module_id=module_id)
        return list(rows.order_by("created_at"))
    finally:
        django.db.close_old_connections()


def list_all() -> list[Worktree]:
    """Return every persisted worktree row, any status (used by reconcile)."""

    try:
        return list(Worktree.objects.all())
    finally:
        django.db.close_old_connections()
