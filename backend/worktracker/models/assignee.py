from django.db import models


class Assignee(models.Model):
    """A display-only assignee record referenced by issues."""

    id = models.UUIDField(primary_key=True)
    display_name = models.CharField(max_length=255, blank=True, default="")
    email = models.EmailField(blank=True, default="")

    def __str__(self):
        return self.display_name or self.email
