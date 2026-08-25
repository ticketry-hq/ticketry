from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0016_agentrun_launch_reasoning")]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="launch_unattended",
            field=models.BooleanField(default=False),
        )
    ]
