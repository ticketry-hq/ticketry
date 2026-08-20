from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("terminals", "0007_restore_agent_run_fk_cascade")]

    operations = [
        migrations.RenameIndex(
            model_name="agentterminalsession",
            old_name="idx_agent_terminal_sessions_task_created",
            new_name="idx_terminal_task_created",
        ),
    ]
