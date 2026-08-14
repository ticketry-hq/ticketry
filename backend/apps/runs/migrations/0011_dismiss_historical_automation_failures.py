from django.db import migrations, models
from django.utils import timezone


def dismiss_historical_failures(apps, schema_editor):
    AutomationAttempt = apps.get_model("runs", "AutomationAttempt")
    AutomationAttempt.objects.filter(
        status="failed",
        dismissed_at__isnull=True,
    ).update(dismissed_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [("runs", "0010_make_required_skill_failures_retryable")]

    operations = [
        migrations.AddField(
            model_name="automationattempt",
            name="dismissed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(
            dismiss_historical_failures,
            migrations.RunPython.noop,
        ),
    ]
