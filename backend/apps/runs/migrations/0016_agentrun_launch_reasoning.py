from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0015_agentrun_initial_prompt")]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="launch_reasoning",
            field=models.CharField(null=True),
        )
    ]
