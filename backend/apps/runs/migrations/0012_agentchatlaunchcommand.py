import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0011_agentchatcommand")]

    operations = [
        migrations.AddField(
            model_name="agentchatcommand",
            name="request_fingerprint",
            field=models.CharField(max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="agentchatsession",
            name="resume_token",
            field=models.CharField(max_length=32, null=True),
        ),
        migrations.CreateModel(
            name="AgentChatLaunchCommand",
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
                ("command_id", models.CharField(max_length=128, unique=True)),
                ("request_fingerprint", models.CharField(max_length=64)),
                ("agent_run_id", models.CharField(max_length=255)),
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
                ("error", models.TextField(null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "agent_chat_launch_commands"},
        ),
    ]
