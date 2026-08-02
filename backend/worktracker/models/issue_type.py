from django.db import models
from .project import Project
from .constants import LEVEL_CHOICES
from .state import State


class IssueType(models.Model):
    """A per-project, configurable issue type (G1, S6).

    Layered *on top of* the binary ``Issue.type`` discriminator, never
    replacing it: ``level`` pins each named type ("Module", "Story", "Bug") to
    exactly one binary bucket, so the tree and every route keep branching on
    ``Issue.type`` unchanged. Every issue selects exactly one type explicitly.
    """

    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="issue_types"
    )
    name = models.CharField(max_length=255)
    level = models.CharField(max_length=10, choices=LEVEL_CHOICES)
    color = models.CharField(max_length=32, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    start_state = models.ForeignKey(
        State,
        on_delete=models.SET_NULL,
        related_name="starting_issue_types",
        null=True,
        blank=True,
    )
    workflow_revision = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("project", "name")

    def __str__(self):
        return f"{self.name} ({self.level})"
