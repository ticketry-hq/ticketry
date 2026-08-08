import django.db.models.deletion
import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0009_automationattempt_launch_rejection")]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="run_kind",
            field=models.CharField(
                choices=[("terminal", "Terminal"), ("chat", "Chat")],
                default="terminal",
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="AgentChatSession",
            fields=[
                (
                    "run",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="chat_session",
                        serialize=False,
                        to="runs.agentrun",
                    ),
                ),
                ("provider_thread_id", models.CharField(null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("starting", "Starting"),
                            ("ready", "Ready"),
                            ("running", "Running"),
                            ("interrupted", "Interrupted"),
                            ("stopped", "Stopped"),
                            ("error", "Error"),
                        ],
                        default="starting",
                        max_length=16,
                    ),
                ),
                ("active_turn_id", models.CharField(null=True)),
                ("last_error", models.TextField(null=True)),
                ("next_sequence", models.PositiveBigIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "agent_chat_sessions"},
        ),
        migrations.CreateModel(
            name="AgentChatEvent",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("sequence", models.PositiveBigIntegerField()),
                ("event_type", models.CharField(max_length=96)),
                ("payload", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="events",
                        to="runs.agentchatsession",
                    ),
                ),
            ],
            options={
                "db_table": "agent_chat_events",
                "ordering": ["sequence"],
                "indexes": [
                    models.Index(
                        fields=["session", "sequence"],
                        name="idx_chat_event_session_seq",
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("session", "sequence"),
                        name="uniq_chat_event_session_sequence",
                    )
                ],
            },
        ),
    ]
