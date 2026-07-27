from django.db import models
from .issue import Issue


class Attachment(models.Model):
    """A file attached to an issue, stored on local disk under MEDIA_ROOT (C6)."""

    id = models.UUIDField(primary_key=True)
    issue = models.ForeignKey(
        Issue, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(upload_to="worktracker/attachments/")
    filename = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255, blank=True, default="")
    size = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.filename
