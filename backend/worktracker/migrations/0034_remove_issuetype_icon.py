from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0033_delete_forcetransition"),
        ("worktracker", "0033_explicit_issue_types"),
        ("worktracker", "0033_remove_assignee"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="issuetype",
            name="icon",
        ),
    ]
