from django.db import models, transaction
from .project import Project
from .issue_type import IssueType
from .state import State
from .constants import TYPE_CHOICES
from worktracker.state import normalize_state_id


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
    # Latest committed workflow-state transition for this WorkItem. Together
    # with Project.state_revision this row is the compact replay projection.
    state_revision = models.PositiveBigIntegerField(default=0)
    name = models.CharField(max_length=512)
    sequence_id = models.PositiveIntegerField()
    is_archived = models.BooleanField(default=False)
    # Fractional-index sort key for manual within-column reorder (#626). A
    # single global key per issue (Jira/LexoRank model); each board / story-map
    # column sorts only its own members by it, so two issues in different
    # columns are never compared. Reorder is the sole write path
    # (worktracker.ranking.key_between); the migration backfills it in
    # ``sequence_id`` order so nothing moves on first load.
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
        """Persist state identity and its project revision atomically.

        All supported state writers use ``Issue.save``. Serializing them on the
        project row gives every real state identity change one durable,
        project-monotonic revision, including create-into-state. Narrow saves
        that omit ``state`` do not participate.
        """

        update_fields = kwargs.get("update_fields")
        if update_fields is not None and not {"state", "state_id"}.intersection(
            update_fields
        ):
            return super().save(*args, **kwargs)
        if self._state.adding and self.state_id is None:
            return super().save(*args, **kwargs)

        using = kwargs.get("using") or self._state.db or "default"
        with transaction.atomic(using=using):
            old_state_id = (
                Issue.objects.using(using)
                .filter(pk=self.pk)
                .values_list("state_id", flat=True)
                .first()
            )
            if normalize_state_id(old_state_id) != normalize_state_id(self.state_id):
                self.state_revision = Project.next_state_revision(
                    self.project_id, using=using
                )
                if update_fields is not None:
                    kwargs["update_fields"] = tuple(
                        dict.fromkeys((*update_fields, "state_revision"))
                    )
            return super().save(*args, **kwargs)
