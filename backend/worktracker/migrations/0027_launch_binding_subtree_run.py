from django.db import migrations, models


def enable_story_subtree_run(apps, schema_editor):
    """Turn subtree-run on for Story states a launch can actually happen in.

    The flag rides on ``LaunchBinding``, so writing a row for every (Story,
    state) pair in a project fabricates an empty launch policy for states that
    are not even part of the Story workflow. Scope it to the workflow's own
    states — its start state plus every transition endpoint — and fall back to
    the project's states only for a type with no workflow configured yet, so
    no install loses the capability outright.
    """

    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    State = apps.get_model("worktracker", "State")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias

    stories = IssueType.objects.using(alias).filter(name="Story", level="task")
    for story in stories.iterator():
        state_ids = set()
        if story.start_state_id is not None:
            state_ids.add(story.start_state_id)
        for endpoints in IssueTypeTransition.objects.using(alias).filter(
            issue_type_id=story.id
        ).values_list("from_state_id", "to_state_id"):
            state_ids.update(endpoints)
        if not state_ids:
            state_ids = set(
                State.objects.using(alias).filter(
                    project_id=story.project_id
                ).values_list(
                    "id", flat=True
                )
            )
        for state_id in state_ids:
            LaunchBinding.objects.using(alias).update_or_create(
                issue_type_id=story.id,
                state_id=state_id,
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
