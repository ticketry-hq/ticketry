from django.db import migrations, models


def make_project_slugs_unique(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    alias = schema_editor.connection.alias
    used = set()
    projects = Project.objects.using(alias).order_by("created_at", "id")
    reserved = set(projects.values_list("slug", flat=True))
    for project in projects.iterator():
        original = project.slug
        candidate = original
        if original in used:
            suffix = 2
            while True:
                marker = f"-{suffix}"
                candidate = f"{original[: 64 - len(marker)]}{marker}"
                suffix += 1
                if candidate not in reserved:
                    break
        used.add(candidate)
        reserved.add(candidate)
        if candidate != original:
            Project.objects.using(alias).filter(pk=project.pk).update(slug=candidate)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0045_project_onboarding_required")]

    operations = [
        migrations.AlterUniqueTogether(name="project", unique_together=set()),
        migrations.RunPython(make_project_slugs_unique, migrations.RunPython.noop),
        migrations.RemoveField(model_name="project", name="workspace"),
        migrations.AlterField(
            model_name="project",
            name="slug",
            field=models.CharField(max_length=64, unique=True),
        ),
        migrations.DeleteModel(name="Workspace"),
    ]
