from django.db import migrations, models


def enable_story_subtree_run(apps, _schema_editor):
    IssueType = apps.get_model("worktracker", "IssueType")
    State = apps.get_model("worktracker", "State")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")

    stories = IssueType.objects.filter(name="Story", level="task")
    for story in stories.iterator():
        for state in State.objects.filter(project_id=story.project_id).iterator():
            LaunchBinding.objects.update_or_create(
                issue_type_id=story.id,
                state_id=state.id,
                defaults={"subtree_run_enabled": True},
            )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0026_delete_legacy_workflow_models")]

    operations = [
        migrations.AddField(
            model_name="launchbinding",
            name="subtree_run_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            enable_story_subtree_run,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
