from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0030_migrate_matt_style_workflow"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="issue",
            name="lifecycle_state",
        ),
    ]
