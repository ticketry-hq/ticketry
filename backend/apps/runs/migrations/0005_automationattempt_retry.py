import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("runs", "0004_automationattempt")]

    operations = [
        migrations.AlterField(
            model_name="automationattempt",
            name="transition_id",
            field=models.UUIDField(),
        ),
        migrations.AddField(
            model_name="automationattempt",
            name="retry_of",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="retry_attempt",
                to="runs.automationattempt",
            ),
        ),
        migrations.AddField(
            model_name="automationattempt",
            name="root_attempt",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="retry_descendants",
                to="runs.automationattempt",
            ),
        ),
        migrations.AddConstraint(
            model_name="automationattempt",
            constraint=models.UniqueConstraint(
                condition=models.Q(("retry_of__isnull", True)),
                fields=("transition_id",),
                name="uniq_auto_attempt_transition_root",
            ),
        ),
    ]
