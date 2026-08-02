import django.db.models.deletion
from django.db import migrations, models


def backfill_and_validate_issue_types(apps, schema_editor):
    """Type every historical issue before the default flag disappears."""

    Issue = apps.get_model("worktracker", "Issue")
    IssueType = apps.get_model("worktracker", "IssueType")
    alias = schema_editor.connection.alias

    untyped = Issue.objects.using(alias).filter(issue_type__isnull=True)
    scopes = list(
        untyped.values_list("project_id", "type")
        .distinct()
        .order_by("project_id", "type")
    )
    for project_id, level in scopes:
        candidates = list(
            IssueType.objects.using(alias)
            .filter(project_id=project_id, level=level, is_default=True)
            .order_by("sort_order", "created_at", "id")
        )
        if not candidates:
            count = untyped.filter(project_id=project_id, type=level).count()
            raise RuntimeError(
                "Cannot migrate untyped work items: project "
                f"{project_id} has {count} untyped {level} issue(s) and no "
                f"configured default {level} IssueType."
            )
        # Historical data had no database uniqueness constraint for the default
        # flag. If it was corrupted, preserve a deterministic result.
        selected = candidates[0]
        untyped.filter(project_id=project_id, type=level).update(issue_type=selected)

    types = {
        issue_type.id: (issue_type.project_id, issue_type.level)
        for issue_type in IssueType.objects.using(alias).all()
    }
    for issue in Issue.objects.using(alias).all().only(
        "id", "project_id", "type", "issue_type_id"
    ):
        selected = types.get(issue.issue_type_id)
        if selected is None:
            raise RuntimeError(
                f"Cannot enforce explicit IssueType: issue {issue.id} is untyped."
            )
        if selected != (issue.project_id, issue.type):
            raise RuntimeError(
                "Cannot enforce explicit IssueType: issue "
                f"{issue.id} has project/level ({issue.project_id}, {issue.type}) "
                f"but IssueType {issue.issue_type_id} has {selected}."
            )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0032_canonical_issue_description")]

    operations = [
        migrations.RunPython(backfill_and_validate_issue_types, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="issue",
            name="issue_type",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="issues",
                to="worktracker.issuetype",
            ),
        ),
        migrations.RemoveField(model_name="issuetype", name="is_default"),
    ]
