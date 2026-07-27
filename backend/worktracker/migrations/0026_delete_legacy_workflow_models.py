from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0025_per_type_transitions")]

    operations = [
        migrations.DeleteModel(name="ProjectWorkflowSettings"),
        migrations.DeleteModel(name="ProjectWorkflowGraph"),
        migrations.DeleteModel(name="WorkflowConfiguration"),
    ]
