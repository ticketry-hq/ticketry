from django.db import migrations, models

from worktracker.models.constants import LIFECYCLE_CHOICES


class Migration(migrations.Migration):

    dependencies = [
        ("worktracker", "0008_state_is_protected_and_blocked"),
    ]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="lifecycle_state",
            field=models.CharField(
                max_length=32,
                choices=LIFECYCLE_CHOICES,
                null=True,
                blank=True,
                default=None,
            ),
        ),
    ]
