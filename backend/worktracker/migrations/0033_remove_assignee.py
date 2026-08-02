from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0032_canonical_issue_description"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="issue",
            name="assignees",
        ),
        migrations.DeleteModel(
            name="Assignee",
        ),
    ]
