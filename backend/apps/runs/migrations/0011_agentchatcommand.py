import django.db.models.deletion
import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0010_chat_runs")]

    operations = [
        migrations.CreateModel(
            name="AgentChatCommand",
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
                ("command_id", models.CharField(max_length=128)),
                ("command_type", models.CharField(max_length=32)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("result", models.JSONField(null=True)),
                ("error", models.TextField(null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="commands",
                        to="runs.agentchatsession",
                    ),
                ),
            ],
            options={
                "db_table": "agent_chat_commands",
                "constraints": [
                    models.UniqueConstraint(
                        fields=("session", "command_id"),
                        name="uniq_chat_command_session_id",
                    )
                ],
            },
        ),
    ]
