from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [
        ("settings_store", "0002_migrate_profile_prompt_authority"),
        ("worktracker", "0043_story_run_now_workflow"),
    ]

    operations = [
        migrations.CreateModel(
            name="ModuleLink",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("local_path", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "module",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="host_module_link",
                        to="worktracker.issue",
                    ),
                ),
            ],
            options={"db_table": "module_links"},
        ),
    ]
