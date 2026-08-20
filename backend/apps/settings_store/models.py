import uuid

from django.db import models


class AppSetting(models.Model):
    """Persist one scoped application setting."""

    pk = models.CompositePrimaryKey("scope", "key")
    scope = models.CharField()
    key = models.CharField()
    value = models.CharField()
    updated_at = models.CharField()

    class Meta:
        db_table = "app_settings"


class ModuleLink(models.Model):
    """Bind one shared module work item to this host's canonical folder."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    module = models.OneToOneField(
        "worktracker.Issue",
        on_delete=models.CASCADE,
        related_name="host_module_link",
    )
    local_path = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "module_links"
