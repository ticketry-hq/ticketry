import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0003_drop_orchestrator_tables"),
        ("worktracker", "0018_launch_binding"),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationAttempt",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, primary_key=True, serialize=False)),
                ("transition_id", models.UUIDField(unique=True)),
                ("from_state_id", models.UUIDField()),
                ("to_state_id", models.UUIDField()),
                ("workflow_revision", models.PositiveIntegerField()),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("succeeded", "Succeeded"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("agent", models.CharField(blank=True, max_length=64, null=True)),
                ("agent_run_id", models.CharField(blank=True, max_length=255, null=True)),
                ("error", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "issue",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="automation_attempts",
                        to="worktracker.issue",
                    ),
                ),
            ],
            options={
                "db_table": "automation_attempts",
                "indexes": [
                    models.Index(
                        fields=["issue", "-created_at"],
                        name="idx_auto_attempt_issue_created",
                    )
                ],
            },
        )
    ]
