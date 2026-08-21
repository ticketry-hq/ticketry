from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("worktrees", "0001_initial")]

    operations = [
        migrations.RemoveField(model_name="worktree", name="workspace_slug"),
    ]
