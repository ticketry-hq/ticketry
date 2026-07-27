import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0022_shared_workflow_graph")]

    operations = [
        migrations.CreateModel(
            name="ProjectWorkflowSettings",
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
                ("draft", models.JSONField(default=dict)),
                ("revision", models.PositiveIntegerField(default=0)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "project",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="workflow_settings",
                        to="worktracker.project",
                    ),
                ),
            ],
        )
    ]
