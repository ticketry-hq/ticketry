import uuid

from django.db import migrations, models

def backfill(apps, schema_editor):
    """Add Blocked to every project, renumber, and stamp protected flags (#629)."""

    Project = apps.get_model("worktracker", "Project")
    State = apps.get_model("worktracker", "State")
    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    states = State.objects.using(alias)
    for project in Project.objects.using(alias).all():
        states.get_or_create(
            project=project,
            name="Blocked",
            group="unstarted",
            defaults={"id": uuid.uuid4()},
        )
        order = {
            "Backlog": 0, "Todo": 1, "Blocked": 2, "In Progress": 3,
            "Done": 4, "Cancelled": 5,
        }
        rows = sorted(
            states.filter(project=project),
            key=lambda state: (order.get(state.name, 99), state.created_at),
        )
        for index, state in enumerate(rows):
            changed = []
            if state.sort_order != index:
                state.sort_order = index
                changed.append("sort_order")
            if state.name in {"Blocked", "In Progress", "Done"} and not state.is_protected:
                state.is_protected = True
                changed.append("is_protected")
            if changed:
                state.save(using=alias, update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0007_sprint_lifecycle"),
    ]

    operations = [
        migrations.AddField(
            model_name="state",
            name="is_protected",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
