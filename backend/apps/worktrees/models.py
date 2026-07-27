from django.db import models


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

    class Meta:
        db_table = "worktrees"
