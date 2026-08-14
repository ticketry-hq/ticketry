from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0008_agentrun_issue")]

    operations = [
        migrations.AddField(
            model_name="automationattempt",
            name="error_details",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="automationattempt",
            name="retryable",
            field=models.BooleanField(default=True),
        ),
    ]
