from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('execution', '0005_launchedtask_delete_enginerun'),
    ]

    operations = [
        migrations.AddField(
            model_name='graphrun',
            name='execution_mode',
            # Existing armed campaigns predate the mode and are parallel.
            field=models.CharField(
                choices=[('parallel', 'Parallel'), ('serial', 'Serial')],
                default='parallel',
                max_length=16,
            ),
        ),
    ]
