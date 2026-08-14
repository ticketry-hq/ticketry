from django.db import models, transaction
from .project import Project
from .issue_type import IssueType
from .state import State
from .constants import TYPE_CHOICES


_REVISION_FIELDS = (
    "project_id",
    "type",
    "issue_type_id",
    "parent_id",
    "module_id",
    "state_id",
    "name",
    "sequence_id",
    "is_archived",
    "rank",
    "description",
)


class Issue(models.Model):
    """The unified work item — both modules and tasks live in this table.

    A single JIRA-like table discriminated by ``type``:

    - ``type`` splits modules from tasks; routes filter on it.
    - ``parent`` is the one tree link — epic membership AND subtask parent.
    - ``state`` is a single FK, serialized as its bare primary key.
    - ``sequence_id`` is allocated from the project's shared counter, so the
      ``key`` (``{project.slug}-{sequence_id}``) is unique within the project.
    """

    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="issues"
    )
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    issue_type = models.ForeignKey(
        IssueType,
        on_delete=models.PROTECT,
        related_name="issues",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    module = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="module_members",
        limit_choices_to={"type": "module"},
    )
    state = models.ForeignKey(
        State,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="issues",
    )
    # Latest committed change for this WorkItem. Together with
    # Project.state_revision this row is the compact replay projection.
    state_revision = models.PositiveBigIntegerField(default=0)
    name = models.CharField(max_length=512)
    sequence_id = models.PositiveIntegerField()
    is_archived = models.BooleanField(default=False)
    # Fractional-index sort key for manual reorder (#626). A single global key
    # per issue (Jira/LexoRank model); each sibling group sorts only its own
    # members by it, so two issues in different groups are never compared. It
    # carries two orders: a task's position within its planning-context column,
    # and — for module work items — the module's position within its project's
    # Manual module order. Reorder is the sole write path
    # (worktracker.ranking.key_between); the migration backfills it in
    # ``sequence_id`` order so nothing moves on first load. Module ranks are
    # ignored entirely until ``Project.manual_module_order`` is true.
    rank = models.CharField(max_length=64, blank=True, default="", db_index=True)
    description = models.TextField(blank=True, default="")
    # A directed Issue↔Issue blocker relation (#624), orthogonal to the parent
    # tree. ``blocked_by`` = the issues blocking this one; the reverse
    # ``blocks`` manager (free, from related_name) = the issues this one blocks.
    # symmetrical=False makes the edge directed; deleting either end drops the
    # join row, never the issue (M2M, not a nulled FK).
    blocked_by = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="blocks",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("project", "sequence_id")
        indexes = [
            models.Index(fields=["project", "type"]),
            models.Index(fields=["parent"]),
            models.Index(fields=["module"]),
            models.Index(
                fields=["project", "state_revision"],
                name="wt_issue_proj_state_rev_idx",
            ),
        ]

    @property
    def key(self):
        """Return the addressable key, e.g. ``MEML-7``."""
        return f"{self.project.slug}-{self.sequence_id}"

    def __str__(self):
        return f"{self.key} {self.name}"

    def save(self, *args, **kwargs):
        """Persist the issue and its project change revision atomically.

        Every supported writer crosses ``Issue.save`` before commit. Serializing
        changed records on the project row gives creates, field edits, reorders
        and workflow moves one durable, project-monotonic cursor for live
        delivery and reconnect replay. M2M-only writers opt in with
        ``force_change_revision`` after validating their pending relation edit.
        """

        force_change_revision = kwargs.pop("force_change_revision", False)
        update_fields = kwargs.get("update_fields")
        using = kwargs.get("using") or self._state.db or "default"
        with transaction.atomic(using=using):
            persisted = (
                None
                if self._state.adding
                else Issue.objects.using(using)
                .filter(pk=self.pk)
                .values(*_REVISION_FIELDS)
                .first()
            )
            written_fields = (
                set(_REVISION_FIELDS)
                if update_fields is None
                else {
                    field
                    for field in _REVISION_FIELDS
                    if field in update_fields
                    or field.removesuffix("_id") in update_fields
                }
            )
            changed = force_change_revision or persisted is None or any(
                persisted[field] != getattr(self, field) for field in written_fields
            )
            self._work_item_change_revision_advanced = changed
            if changed:
                self.state_revision = Project.next_state_revision(
                    self.project_id, using=using
                )
                if update_fields is not None:
                    kwargs["update_fields"] = tuple(
                        dict.fromkeys((*update_fields, "state_revision"))
                    )
            return super().save(*args, **kwargs)
