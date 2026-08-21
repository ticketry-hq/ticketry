from django.db import migrations, models
import django.db.models.deletion


def preserve_manual_module_order(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    Issue = apps.get_model("worktracker", "Issue")
    ModulePresentation = apps.get_model("worktracker", "ModulePresentation")

    manual_project_ids = Project.objects.filter(manual_module_order=True).values_list(
        "id", flat=True
    )
    presentations = [
        ModulePresentation(module_id=module.id, rank=module.rank)
        for module in Issue.objects.filter(
            project_id__in=manual_project_ids,
            type="module",
        )
    ]
    ModulePresentation.objects.bulk_create(presentations, batch_size=500)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0049_issue_workspace_tab_order")]

    operations = [
        migrations.CreateModel(
            name="ModulePresentation",
            fields=[
                (
                    "module",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="presentation",
                        serialize=False,
                        to="worktracker.issue",
                    ),
                ),
                (
                    "rank",
                    models.CharField(
                        blank=True, db_index=True, default="", max_length=64
                    ),
                ),
                ("tab_hidden", models.BooleanField(default=False)),
            ],
        ),
        migrations.RunPython(
            preserve_manual_module_order,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.RemoveField(model_name="project", name="manual_module_order"),
    ]
