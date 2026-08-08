from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("runs", "0009_collapse_terminal_session"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="agentrun",
            name="ticket_seq",
        ),
    ]
