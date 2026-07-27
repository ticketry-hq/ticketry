from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("runs", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="resumed_from",
            field=models.CharField(null=True),
        ),
    ]
