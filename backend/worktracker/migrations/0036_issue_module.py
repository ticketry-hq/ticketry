from django.db import migrations, models
import django.db.models.deletion


def backfill_module_ancestors(apps, schema_editor):
    Issue = apps.get_model("worktracker", "Issue")
    alias = schema_editor.connection.alias

    frontier = {
        issue_id: issue_id
        for issue_id in Issue.objects.using(alias)
        .filter(type="module")
        .values_list("id", flat=True)
    }
    while frontier:
        children = list(
            Issue.objects.using(alias)
            .filter(type="task", parent_id__in=frontier)
            .only("id", "parent_id", "module_id")
        )
        for child in children:
            child.module_id = frontier[child.parent_id]
        Issue.objects.using(alias).bulk_update(children, ["module"], batch_size=500)
        frontier = {child.id: child.module_id for child in children}


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0035_remove_labels"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="module",
            field=models.ForeignKey(
                blank=True,
                limit_choices_to={"type": "module"},
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="module_members",
                to="worktracker.issue",
            ),
        ),
        migrations.AddIndex(
            model_name="issue",
            index=models.Index(
                fields=["module"], name="worktracker_module__f27859_idx"
            ),
        ),
        migrations.RunPython(
            backfill_module_ancestors,
            migrations.RunPython.noop,
        ),
    ]
