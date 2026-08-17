# Terminal output activity axis (#661).

from django.db import migrations, models


def baseline_live_sessions(apps, schema_editor):
    """Give every existing live session a safe inactivity origin.

    Sequence zero and no observed identity are the field defaults; the only
    fact that must be backfilled is the origin the stall boundary is measured
    from. Session creation time is the conservative choice: a session that has
    been silent since before this migration is already past the boundary, and
    one created moments ago keeps its full grace period.
    """

    session_model = apps.get_model("terminals", "AgentTerminalSession")
    session_model.objects.filter(
        terminated_at__isnull=True,
        last_output_at__isnull=True,
    ).update(last_output_at=models.F("created_at"))


class Migration(migrations.Migration):
    dependencies = [
        ("terminals", "0004_agentterminalsession_runtime_namespace"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentterminalsession",
            name="output_identity",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="agentterminalsession",
            name="output_sequence",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agentterminalsession",
            name="last_output_at",
            field=models.CharField(null=True),
        ),
        migrations.RunPython(
            baseline_live_sessions,
            migrations.RunPython.noop,
        ),
    ]
