from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('worktracker', '0002_sprint_issue_sprint'),
    ]

    operations = [
        migrations.AddField(
            model_name='issue',
            name='is_archived',
            field=models.BooleanField(default=False),
        ),
    ]
