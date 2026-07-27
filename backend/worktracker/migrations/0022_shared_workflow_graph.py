import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0021_work_item_state_revisions")]

    operations = [
        migrations.CreateModel(
            name="ProjectWorkflowGraph",
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
                ("edges", models.JSONField(default=list)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "project",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="shared_workflow_graph",
                        to="worktracker.project",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="workflowconfiguration",
            name="transition_override",
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
