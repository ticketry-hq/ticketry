from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0032_canonical_issue_description"),
    ]

    operations = [
        migrations.DeleteModel(
            name="ForceTransition",
        ),
    ]
