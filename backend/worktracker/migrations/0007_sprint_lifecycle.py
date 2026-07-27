import re

from django.db import migrations, models

# A sprint name minted by the auto-counter, e.g. "Sprint 3". The backfill
# parses the trailing integer to recover the high-water mark per project.
_SPRINT_NAME = re.compile(r"^Sprint (\d+)$")


def backfill_sprint_seq(apps, schema_editor):
    """Seed each project's ``sprint_seq`` from its existing sprint names (#634).

    The counter is the high-water mark of trailing integers parsed from sprint
    names matching ``Sprint N`` — so the next minted name never collides with a
    sprint created before the counter existed. Names that don't match the
    pattern (custom names) contribute nothing. Rerun-safe: recomputing the max
    from the same names always yields the same value, so a second run is a
    no-op. ``goal`` needs no backfill beyond its field default ("").
    """

    Project = apps.get_model("worktracker", "Project")
    Sprint = apps.get_model("worktracker", "Sprint")

    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    for project in Project.objects.using(alias).all():
        high = 0
        for name in Sprint.objects.using(alias).filter(project=project).values_list(
            "name", flat=True
        ):
            m = _SPRINT_NAME.match(name or "")
            if m:
                high = max(high, int(m.group(1)))
        if project.sprint_seq != high:
            project.sprint_seq = high
            project.save(using=alias, update_fields=["sprint_seq"])


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0006_issue_rank"),
    ]

    operations = [
        migrations.AddField(
            model_name="sprint",
            name="goal",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="project",
            name="sprint_seq",
            field=models.PositiveIntegerField(default=0),
        ),
        # Seed the counter from existing Sprint N names. Reverse is a no-op:
        # the AddField above drops the column, the data has nowhere to go.
        migrations.RunPython(backfill_sprint_seq, migrations.RunPython.noop),
    ]
