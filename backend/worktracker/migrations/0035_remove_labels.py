from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("worktracker", "0034_remove_issuetype_icon"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="issue",
            name="labels",
        ),
        migrations.DeleteModel(
            name="Label",
        ),
    ]
