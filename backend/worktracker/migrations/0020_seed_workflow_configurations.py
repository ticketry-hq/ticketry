from django.db import migrations


def seed_known_workflows(apps, schema_editor):
    from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES

    Project = apps.get_model("worktracker", "Project")
    IssueType = apps.get_model("worktracker", "IssueType")
    State = apps.get_model("worktracker", "State")
    WorkflowConfiguration = apps.get_model("worktracker", "WorkflowConfiguration")
    for project in Project.objects.all():
        states = {
            state.name: state for state in State.objects.filter(project=project)
        }
        for type_name, template in DEFAULT_WORKFLOW_TEMPLATES.items():
            issue_type = IssueType.objects.filter(
                project=project,
                name=type_name,
                level="task",
            ).first()
            if issue_type is None:
                continue
            transitions = template["transitions"]
            referenced_names = set(transitions)
            referenced_names.update(
                target for targets in transitions.values() for target in targets
            )
            if not referenced_names.issubset(states):
                continue
            graph = {
                "start_state_id": str(states[template["start"]].id),
                "terminal_state_ids": [
                    str(states[name].id)
                    for name, targets in transitions.items()
                    if not targets
                ],
                "edges": [
                    {
                        "from": str(states[source].id),
                        "to": str(states[target].id),
                        "auto_launch": False,
                    }
                    for source, targets in transitions.items()
                    for target in targets
                ],
            }
            WorkflowConfiguration.objects.get_or_create(
                issue_type=issue_type,
                defaults={"draft": graph, "active": graph, "revision": 1},
            )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0019_refresh_default_launch_prompts")]

    operations = [
        migrations.RunPython(seed_known_workflows, migrations.RunPython.noop),
    ]
