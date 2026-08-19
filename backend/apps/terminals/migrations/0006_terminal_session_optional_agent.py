"""Let the terminal-session mirror carry no agent (#665).

The mirror copies the run's provider slug, so it widens with the run: a shell
run has no provider on either row. Existing rows keep their slug untouched.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("terminals", "0005_terminal_output_activity"),
    ]

    operations = [
        migrations.AlterField(
            model_name="agentterminalsession",
            name="agent",
            field=models.CharField(null=True),
        ),
    ]
