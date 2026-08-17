"""Snapshot the state and model a run was launched with (#693).

Forward-only widening: two nullable columns are added and nothing is
rewritten. Existing rows keep both values null, which means "not recorded" and
stays distinct from every real workflow state. They are deliberately not
backfilled — the state a historical run launched in is unrecoverable, and
inferring it from its work item's current state would record a confident lie.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0013_agentrun_optional_agent"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="launch_state",
            field=models.CharField(null=True),
        ),
        migrations.AddField(
            model_name="agentrun",
            name="launch_model",
            field=models.CharField(null=True),
        ),
    ]
