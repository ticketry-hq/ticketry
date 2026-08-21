from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0048_distinguish_workflow_state_colors")]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="workspace_tab_order",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
