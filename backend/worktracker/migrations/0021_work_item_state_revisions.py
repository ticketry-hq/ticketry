from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0020_seed_workflow_configurations")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="state_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="issue",
            name="state_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddIndex(
            model_name="issue",
            index=models.Index(
                fields=["project", "state_revision"],
                name="wt_issue_proj_state_rev_idx",
            ),
        ),
    ]
