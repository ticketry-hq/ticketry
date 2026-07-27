from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0013_remove_sprint_vertical"),
    ]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="onboarding_required",
            field=models.BooleanField(default=False),
        ),
    ]
