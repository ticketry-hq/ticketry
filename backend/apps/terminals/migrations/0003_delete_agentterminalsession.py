from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0010_remove_agentrun_ticket_seq"),
        ("terminals", "0002_agent_run_viewer_lease"),
    ]

    operations = [
        migrations.DeleteModel(
            name="AgentTerminalSession",
        ),
    ]
