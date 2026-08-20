from django.db import migrations, models

DEFAULT_PROJECT_SLUGS = ("CDN", "CODING")


def migrate_onboarding_to_default_project(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    Workspace = apps.get_model("worktracker", "Workspace")
    alias = schema_editor.connection.alias

    workspace = Workspace.objects.using(alias).order_by("created_at", "id").first()
    if workspace is None:
        return

    projects = Project.objects.using(alias).all()
    project = None
    for slug in DEFAULT_PROJECT_SLUGS:
        project = projects.filter(slug=slug).order_by("created_at", "id").first()
        if project is not None:
            break
    if project is None:
        project = projects.order_by("created_at", "id").first()
    if project is not None and workspace.onboarding_required:
        Project.objects.using(alias).filter(pk=project.pk).update(
            onboarding_required=True
        )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0044_codex_5_6_model_catalog")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="onboarding_required",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            migrate_onboarding_to_default_project,
            migrations.RunPython.noop,
        ),
    ]
