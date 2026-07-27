from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0012_canonical_module_issue_type")]

    operations = [
        migrations.RemoveField(model_name="issue", name="sprint"),
        migrations.DeleteModel(name="Sprint"),
        migrations.RemoveField(model_name="project", name="sprint_seq"),
    ]
