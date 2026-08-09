from django.db import models
from .workspace import Workspace


class Project(models.Model):
    """A project owns states and issues and the shared sequence counter.

    Key characteristics:

    - ``slug`` is the project key — the ``MEML`` in ``MEML-7``.
    - ``seq_counter`` is the single shared, type-agnostic increment source;
      every issue create allocates from it (C5).
    """

    id = models.UUIDField(primary_key=True)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="projects"
    )
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=64)
    description = models.TextField(blank=True, default="")
    seq_counter = models.PositiveIntegerField(default=0)
    # Durable cursor for committed WorkItem changes. The Issue persistence
    # boundary allocates from this counter while holding the project row lock,
    # in the same transaction as the write.
    state_revision = models.PositiveBigIntegerField(default=0)
    # The project's module ordering mode. False (the default every project
    # starts and is migrated into) is automatic ordering: the canonical module
    # order is the collection read's newest-created-first fallback, over which
    # Studio applies agent-activity recency. True is Manual module order: the
    # persisted fractional ``Issue.rank`` of the module work items *is* the
    # canonical order and agent activity never rearranges it. A project flips
    # to manual on its first module drag and, in this version, never back.
    manual_module_order = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("workspace", "slug")

    def __str__(self):
        return self.slug

    @classmethod
    def next_state_revision(cls, project_id, *, using="default"):
        """Allocate the next project WorkItem revision inside the caller's txn."""

        project = (
            cls.objects.using(using)
            .select_for_update()
            .only("state_revision")
            .get(pk=project_id)
        )
        project.state_revision += 1
        project.save(update_fields=["state_revision"], using=using)
        return project.state_revision
