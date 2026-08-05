from django.db import migrations, models
import django.db.models.deletion


def seed_known_bindings(apps, schema_editor):
    from worktracker.seed import ensure_launch_bindings

    Project = apps.get_model("worktracker", "Project")
    IssueType = apps.get_model("worktracker", "IssueType")
    State = apps.get_model("worktracker", "State")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias
    for project in Project.objects.using(alias).all():
        ensure_launch_bindings(
            project, IssueType, State, LaunchBinding, using=alias
        )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0017_complete_workflow_state_colors")]

    operations = [
        migrations.CreateModel(
            name="LaunchBinding",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("prompt", models.TextField(blank=True, default="")),
                ("agent", models.CharField(blank=True, max_length=64, null=True)),
                ("model", models.CharField(blank=True, max_length=255, null=True)),
                ("reasoning", models.CharField(blank=True, max_length=32, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "issue_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="launch_bindings",
                        to="worktracker.issuetype",
                    ),
                ),
                (
                    "state",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="launch_bindings",
                        to="worktracker.state",
                    ),
                ),
            ],
            options={"ordering": ("issue_type__sort_order", "state__sort_order", "id")},
        ),
        migrations.AddConstraint(
            model_name="launchbinding",
            constraint=models.UniqueConstraint(
                fields=("issue_type", "state"), name="unique_launch_binding_type_state"
            ),
        ),
        migrations.RunPython(seed_known_bindings, migrations.RunPython.noop),
    ]
