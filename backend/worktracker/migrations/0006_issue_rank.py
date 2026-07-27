from django.db import migrations, models

from worktracker.ranking import rebalance


def backfill(apps, schema_editor):
    """Stamp a fractional-index ``rank`` on every issue, per project (#626).

    Within each project, issues are ranked in their current visible order
    (``sequence_id``) with evenly spaced keys, so the board and story-map
    columns sort exactly as they do today on first load — nothing moves. One
    global key per issue: columns sort only their own members, so reusing the
    same spacing across the whole project is harmless (see the LLD rank model).
    Idempotent enough to re-run: it always rewrites from the same ordering.
    """

    Project = apps.get_model("worktracker", "Project")
    Issue = apps.get_model("worktracker", "Issue")

    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    for project in Project.objects.using(alias).all():
        issues = list(
            Issue.objects.using(alias).filter(project=project).order_by("sequence_id", "id")
        )
        keys = rebalance(len(issues))
        for issue, key in zip(issues, keys):
            if issue.rank != key:
                issue.rank = key
                issue.save(using=alias, update_fields=["rank"])


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0005_issue_blocked_by"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="rank",
            field=models.CharField(
                blank=True, db_index=True, default="", max_length=64
            ),
        ),
        # Backfill in sequence_id order so today's order is preserved. Reverse
        # drops the column with the AddField above; the data step is a no-op.
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
