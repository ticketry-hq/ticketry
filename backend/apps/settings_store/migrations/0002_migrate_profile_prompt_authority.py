from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("settings_store", "0001_initial"),
        ("worktracker", "0020_seed_workflow_configurations"),
    ]

    # The file-backed prompt migration was retired with profiles. Keep this
    # migration node so existing databases and 0003 retain a stable graph.
    operations = []
