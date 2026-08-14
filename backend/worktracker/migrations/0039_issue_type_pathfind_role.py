from django.db import migrations, models


def mark_canonical_pathfind_types(apps, schema_editor):
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueType.objects.using(schema_editor.connection.alias).filter(
        name="PathFind",
        level="task",
    ).update(is_pathfind=True)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0038_launch_binding_catalog_foreign_keys")]

    operations = [
        migrations.AddField(
            model_name="issuetype",
            name="is_pathfind",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            mark_canonical_pathfind_types,
            migrations.RunPython.noop,
        ),
    ]
