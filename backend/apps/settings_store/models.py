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
