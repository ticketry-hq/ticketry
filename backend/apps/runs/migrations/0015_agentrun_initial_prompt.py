from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0014_agentrun_launch_metadata")]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="initial_prompt",
            field=models.TextField(null=True),
        )
    ]
