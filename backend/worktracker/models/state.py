from django.db import models
from .project import Project
from .constants import GROUP_CHOICES


class State(models.Model):
    """A per-project workflow state, grouped by one of five frozen groups (C3).

    ``sort_order`` (S6, G2) orders states within and across groups; lists are
    returned ordered by ``(sort_order, created_at)``. The ``group`` enum stays
    frozen — states are configurable, the five groups are not.
    """

    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="states"
    )
    name = models.CharField(max_length=255)
    group = models.CharField(max_length=20, choices=GROUP_CHOICES)
    color = models.CharField(max_length=32, blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    is_protected = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name
