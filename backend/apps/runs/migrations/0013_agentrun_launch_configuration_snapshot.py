from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0012_remove_legacy_agentrun_run_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="model",
            field=models.CharField(null=True),
        ),
        migrations.AddField(
            model_name="agentrun",
            name="reasoning",
            field=models.CharField(null=True),
        ),
    ]
