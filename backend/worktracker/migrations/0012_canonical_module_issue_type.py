"""Promote Module to the sole canonical module-level issue type (CODIN-954)."""

import uuid

from django.db import migrations


CANONICAL_TYPES = (
    ("Module", "module", True),
    ("Story", "task", True),
    ("PathFind", "task", False),
    ("Implementation", "task", False),
)


def migrate(apps, schema_editor):
    """Frozen, alias-aware copy of the issue-type reconciliation as of 0012."""

    alias = schema_editor.connection.alias if schema_editor is not None else "default"
    Project = apps.get_model("worktracker", "Project")
    Issue = apps.get_model("worktracker", "Issue")
    IssueType = apps.get_model("worktracker", "IssueType")
    types = IssueType.objects.using(alias)
    issues = Issue.objects.using(alias)

    for project in Project.objects.using(alias).all():
        epic = types.filter(project=project, name="Epic", level="module").first()
        module = types.filter(project=project, name="Module", level="module").first()
        if epic is not None and module is None:
            epic.name = "Module"
            epic.save(using=alias, update_fields=["name"])
            module = epic
        elif epic is not None and module is not None:
            issues.filter(project=project, issue_type=epic).update(issue_type=module)
            epic.delete(using=alias)

        defaults = {}
        for order, (name, level, is_default) in enumerate(CANONICAL_TYPES):
            issue_type, _ = types.get_or_create(
                project=project,
                name=name,
                defaults={
                    "id": uuid.uuid4(),
                    "level": level,
                    "sort_order": order,
                    "is_default": is_default,
                },
            )
            if is_default:
                defaults[level] = issue_type

        for level, default_type in defaults.items():
            types.filter(project=project, level=level).exclude(
                id=default_type.id
            ).update(is_default=False)
            if not default_type.is_default:
                default_type.is_default = True
                default_type.save(using=alias, update_fields=["is_default"])


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0011_forcetransition"),
    ]

    operations = [
        migrations.RunPython(migrate, migrations.RunPython.noop),
    ]
