from django.db import migrations


def _normalise_edges(edges):
    return [
        {
            "from": str(edge.get("from") or ""),
            "to": str(edge.get("to") or ""),
            "auto_launch": edge.get("auto_launch") is True,
        }
        for edge in edges or []
    ]


def _edge_signature(edges):
    return sorted(
        (edge["from"], edge["to"], edge["auto_launch"])
        for edge in _normalise_edges(edges)
    )


def _collapse_terminals(graph, ordered_states):
    graph = graph or {}
    terminal_ids = {str(value) for value in graph.get("terminal_state_ids") or []}
    ordered_terminals = [
        str(state.id) for state in ordered_states if str(state.id) in terminal_ids
    ]
    completed_terminals = [
        str(state.id)
        for state in ordered_states
        if str(state.id) in terminal_ids and state.group == "completed"
    ]
    candidates = completed_terminals or ordered_terminals
    return {
        "start_state_id": str(graph.get("start_state_id") or ""),
        "terminal_state_ids": [candidates[-1]] if candidates else [],
        "edges": _normalise_edges(graph.get("edges")),
    }


def _binding_payload(binding):
    return {
        "state_id": str(binding.state_id),
        "prompt": binding.prompt,
        "agent": binding.agent,
        "model": binding.model,
        "reasoning": binding.reasoning,
    }


def migrate_shared_workflow_settings(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    IssueType = apps.get_model("worktracker", "IssueType")
    State = apps.get_model("worktracker", "State")
    WorkflowConfiguration = apps.get_model("worktracker", "WorkflowConfiguration")
    ProjectWorkflowGraph = apps.get_model("worktracker", "ProjectWorkflowGraph")
    ProjectWorkflowSettings = apps.get_model(
        "worktracker", "ProjectWorkflowSettings"
    )
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias
    projects = Project.objects.using(alias)
    issue_type_rows = IssueType.objects.using(alias)
    state_rows = State.objects.using(alias)
    configuration_rows = WorkflowConfiguration.objects.using(alias)
    graphs = ProjectWorkflowGraph.objects.using(alias)
    settings = ProjectWorkflowSettings.objects.using(alias)
    bindings = LaunchBinding.objects.using(alias)

    for project in projects.all().order_by("id"):
        issue_types = list(
            issue_type_rows.filter(project_id=project.id).order_by(
                "sort_order", "created_at", "id"
            )
        )
        states = list(
            state_rows.filter(project_id=project.id).order_by(
                "sort_order", "created_at", "id"
            )
        )
        configurations = {
            configuration.issue_type_id: configuration
            for configuration in configuration_rows.filter(
                issue_type__project_id=project.id
            )
        }

        default_type = next(
            (
                issue_type
                for issue_type in issue_types
                if issue_type.level == "task" and issue_type.is_default
            ),
            None,
        )
        if default_type is None:
            default_type = next(
                (
                    issue_type
                    for issue_type in issue_types
                    if issue_type.level == "task" and issue_type.name == "Story"
                ),
                None,
            )
        default_configuration = (
            configurations.get(default_type.id) if default_type is not None else None
        )
        shared_edges = _normalise_edges(
            (default_configuration.active or {}).get("edges")
            if default_configuration is not None
            else []
        )
        shared_signature = _edge_signature(shared_edges)
        graphs.update_or_create(
            project_id=project.id,
            defaults={"edges": shared_edges},
        )

        bindings_by_type = {}
        for binding in bindings.filter(
            issue_type__project_id=project.id
        ).order_by("issue_type__sort_order", "state__sort_order", "id"):
            bindings_by_type.setdefault(binding.issue_type_id, []).append(
                _binding_payload(binding)
            )

        type_settings = []
        for issue_type in issue_types:
            configuration = configurations.get(issue_type.id)
            if configuration is None:
                active = {
                    "start_state_id": "",
                    "terminal_state_ids": [],
                    "edges": [],
                }
                transition_override = [] if shared_signature else None
                configuration_rows.create(
                    issue_type_id=issue_type.id,
                    active={},
                    draft={},
                    transition_override=transition_override,
                )
            else:
                active = _collapse_terminals(configuration.active, states)
                transition_override = (
                    None
                    if _edge_signature(active["edges"]) == shared_signature
                    else active["edges"]
                )
                configuration.active = active
                configuration.draft = active
                configuration.transition_override = transition_override
                configuration.save(
                    using=alias,
                    update_fields=[
                        "active",
                        "draft",
                        "transition_override",
                        "updated_at",
                    ]
                )

            terminal_ids = active["terminal_state_ids"]
            type_settings.append(
                {
                    "issue_type_id": str(issue_type.id),
                    "start_state_id": active["start_state_id"],
                    "stop_state_id": terminal_ids[0] if terminal_ids else "",
                    "transition_override": (
                        None
                        if transition_override is None
                        else {"edges": transition_override}
                    ),
                    "launch_bindings": bindings_by_type.get(issue_type.id, []),
                }
            )

        settings.update_or_create(
            project_id=project.id,
            defaults={
                "draft": {
                    "shared_graph": {"edges": shared_edges},
                    "types": type_settings,
                }
            },
        )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0023_project_workflow_settings")]

    operations = [
        migrations.RunPython(
            migrate_shared_workflow_settings,
            migrations.RunPython.noop,
        )
    ]
