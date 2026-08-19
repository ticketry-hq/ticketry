"""Make a run's agent optional so a shell run can exist (#665).

Forward-only widening: every existing row keeps its provider slug, and the
column merely stops requiring one. No row is rewritten and no default is
invented, so agent runs are untouched.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0012_remove_legacy_agentrun_run_kind"),
    ]

    operations = [
        migrations.AlterField(
            model_name="agentrun",
            name="agent",
            field=models.CharField(null=True),
        ),
    ]
