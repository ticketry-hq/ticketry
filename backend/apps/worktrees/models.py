import uuid
from datetime import datetime, timezone

import django.db
from django.db import models


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorktreeManager(models.Manager):
    """Django-native persistence operations for the worktree index."""

    def get_by_task(self, task_id: str):
        return self.filter(task_id=task_id).first()

    def create_for_task(self, *, task_id: str, **fields):
        stamp = now_iso()
        fields.setdefault("status", "active")
        fields.setdefault("ephemeral", False)
        try:
            return self.create(
                id=uuid.uuid4().hex,
                task_id=task_id,
                created_at=stamp,
                updated_at=stamp,
                **fields,
            )
        finally:
            django.db.close_old_connections()

    def set_status(self, task_id: str, status: str) -> bool:
        try:
            return (
                self.filter(task_id=task_id).update(
                    status=status, updated_at=now_iso()
                )
                > 0
            )
        finally:
            django.db.close_old_connections()

    def delete_for_task(self, task_id: str) -> None:
        try:
            self.filter(task_id=task_id).delete()
        finally:
            django.db.close_old_connections()

    def by_scope(self, *, project_id=None, module_id=None):
        try:
            rows = self.all()
            if project_id is not None:
                rows = rows.filter(project_id=project_id)
            if module_id is not None:
                rows = rows.filter(module_id=module_id)
            return list(rows.order_by("created_at"))
        finally:
            django.db.close_old_connections()

    def all_records(self):
        try:
            return list(self.all())
        finally:
            django.db.close_old_connections()


class Worktree(models.Model):
    """Persistent index mapping one top-level task to its git worktree.

    Git owns the real trees and branches; this row is only the index that
    lets a worktree re-attach to its task across restart. ``clean``/``dirty``
    and ``ahead``/``behind`` are never stored here — they are computed live
    from git. The two persisted lifecycle states are ``active`` and
    ``conflict``; terminal transitions (integrated / discarded) delete the row.
    """

    id = models.CharField(primary_key=True)
    task_id = models.CharField(unique=True)
    workspace_slug = models.CharField(null=True)
    project_id = models.CharField(null=True)
    module_id = models.CharField(null=True)
    ticket_seq = models.IntegerField(null=True)
    repo_root = models.CharField()
    path = models.CharField()
    branch = models.CharField()
    base_branch = models.CharField()
    base_commit = models.CharField()
    status = models.CharField()
    ephemeral = models.BooleanField(default=False)
    created_at = models.CharField()
    updated_at = models.CharField()

    objects = WorktreeManager()

    class Meta:
        db_table = "worktrees"
