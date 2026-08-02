from django.db import migrations


def copy_canonical_description(apps, schema_editor):
    Issue = apps.get_model("worktracker", "Issue")
    changed = []
    for issue in Issue.objects.only(
        "id", "description", "description_html", "description_stripped"
    ).iterator():
        canonical = (
            issue.description_html
            or issue.description
            or issue.description_stripped
            or ""
        )
        if issue.description != canonical:
            issue.description = canonical
            changed.append(issue)

    if changed:
        Issue.objects.bulk_update(changed, ["description"], batch_size=500)


def restore_legacy_descriptions(apps, schema_editor):
    Issue = apps.get_model("worktracker", "Issue")
    changed = []
    for issue in Issue.objects.only(
        "id", "description", "description_html", "description_stripped"
    ).iterator():
        issue.description_html = issue.description
        issue.description_stripped = ""
        changed.append(issue)

    if changed:
        Issue.objects.bulk_update(
            changed,
            ["description_html", "description_stripped"],
            batch_size=500,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0031_remove_issue_lifecycle_state"),
    ]

    operations = [
        migrations.RunPython(
            copy_canonical_description,
            restore_legacy_descriptions,
        ),
        migrations.RemoveField(
            model_name="issue",
            name="description_html",
        ),
        migrations.RemoveField(
            model_name="issue",
            name="description_stripped",
        ),
    ]
