from django.db import models


class ModulePresentation(models.Model):
    """Installation-wide presentation settings for one module."""

    module = models.OneToOneField(
        "worktracker.Issue",
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="presentation",
    )
    rank = models.CharField(max_length=64, blank=True, default="", db_index=True)
    tab_hidden = models.BooleanField(default=False)
