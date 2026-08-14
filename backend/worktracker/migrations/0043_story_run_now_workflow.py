from django.db import migrations


RUN_NOW_EDGES = (
    ("Ideas", "Implement"),
    ("Implement", "Grill"),
)


def add_story_run_now_transitions(apps, schema_editor):
    State = apps.get_model("worktracker", "State")
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    alias = schema_editor.connection.alias

    issue_types = IssueType.objects.using(alias)
    transitions = IssueTypeTransition.objects.using(alias)
    states = State.objects.using(alias)

    for story in issue_types.filter(name="Story", level="task").order_by("id"):
        project_states = {
            state.name: state
            for state in states.filter(
                project_id=story.project_id,
                name__in={name for edge in RUN_NOW_EDGES for name in edge},
            )
        }
        changed = False
        for source, target in RUN_NOW_EDGES:
            if source not in project_states or target not in project_states:
                continue
            edge, created = transitions.get_or_create(
                issue_type_id=story.id,
                from_state_id=project_states[source].id,
                to_state_id=project_states[target].id,
                defaults={"agent_allowed": True},
            )
            policy_changed = not created and not edge.agent_allowed
            if policy_changed:
                edge.agent_allowed = True
                edge.save(using=alias, update_fields=["agent_allowed"])
            changed = changed or created or policy_changed

        if changed:
            story.workflow_revision += 1
            story.save(
                using=alias,
                update_fields=["workflow_revision", "updated_at"],
            )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0042_merge_singular_idea_state")]

    operations = [
        migrations.RunPython(
            add_story_run_now_transitions,
            migrations.RunPython.noop,
        )
    ]
