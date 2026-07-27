from django.db import models
from .project import Project


class Label(models.Model):
    """A display-only per-project label referenced by issues."""

    id = models.UUIDField(primary_key=True)
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name="labels"
    )
    name = models.CharField(max_length=255)
    color = models.CharField(max_length=32, blank=True, default="")

    def __str__(self):
        return self.name
