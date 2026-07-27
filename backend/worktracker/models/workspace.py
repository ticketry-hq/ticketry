from django.db import models


class Workspace(models.Model):
    """A single tenant boundary, identified by a unique slug.

    Mirrors WorkTracker's workspace: the top of the tree under which projects,
    states, and issues live. Single-user installs carry exactly one.
    """

    id = models.UUIDField(primary_key=True)
    slug = models.CharField(max_length=255, unique=True)
    name = models.CharField(max_length=255)
    onboarding_required = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.slug
