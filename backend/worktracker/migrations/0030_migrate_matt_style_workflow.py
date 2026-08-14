import importlib
import uuid

from django.db import migrations

from worktracker.launch_seeds import (
    DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE,
    DEFAULT_AUTO_START_BY_STATE,
)
from worktracker.models import DEFAULT_STATES
from worktracker.required_skills import DEFAULT_REQUIRED_SKILLS
from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES


previous_prompts = importlib.import_module(
    "worktracker.migrations.0029_sync_reviewed_launch_prompts"
)
PREVIOUS_DEFAULT_PROMPTS_BY_STATE = {
    "Grill": previous_prompts.PREVIOUS_DEFAULT_PROMPTS["Idea"],
    "Spec": previous_prompts.PREVIOUS_DEFAULT_PROMPTS["Refinement"],
    **{
        state_name: prompt
        for state_name, prompt in previous_prompts.PREVIOUS_DEFAULT_PROMPTS.items()
        if state_name not in {"Idea", "Refinement", "Ready"}
    },
}


def _canonical_states(project, State, alias):
    state_rows = State.objects.using(alias)
    states = {
        state.name: state
        for state in state_rows.filter(project_id=project.id).order_by("id")
    }
    for previous_name, current_name in (
        ("Idea", "Grill"),
        ("Refinement", "Spec"),
    ):
        previous_state = states.pop(previous_name, None)
        if previous_state is None:
            continue
        if current_name in states:
            # A project already carrying the new row is a replay/partial-upgrade
            # case. Leave both rows alone rather than deleting project-owned data.
            continue
        previous_state.name = current_name
        previous_state.save(using=alias, update_fields=["name"])
        states[current_name] = previous_state

    for sort_order, (name, group, color) in enumerate(DEFAULT_STATES):
        state = states.get(name)
        if state is None:
            state = state_rows.create(
                id=uuid.uuid4(),
                project_id=project.id,
                name=name,
                group=group,
                color=color,
                sort_order=sort_order,
                is_protected=True,
            )
            states[name] = state
            continue

        update_fields = []
        for field, value in (
            ("group", group),
            ("color", color),
            ("sort_order", sort_order),
            ("is_protected", True),
        ):
            if getattr(state, field) != value:
                setattr(state, field, value)
                update_fields.append(field)
        if update_fields:
            state.save(using=alias, update_fields=update_fields)
    return {name: states[name] for name, _group, _color in DEFAULT_STATES}


def _retire_ready(project, states, Issue, State, alias):
    implement = states["Implement"]
    ready_ids = list(
        State.objects.using(alias).filter(
            project_id=project.id, name="Ready"
        ).values_list(
            "id", flat=True
        )
    )
    if not ready_ids:
        return
    Issue.objects.using(alias).filter(
        project_id=project.id, state_id__in=ready_ids
    ).update(
        state_id=implement.id
    )
    State.objects.using(alias).filter(id__in=ready_ids).delete()


def _rebuild_type_workflows(
    project,
    states,
    IssueType,
    IssueTypeTransition,
    alias,
):
    issue_types = IssueType.objects.using(alias)
    transitions = IssueTypeTransition.objects.using(alias)
    canonical_state_ids = {state.id for state in states.values()}
    for type_name, template in DEFAULT_WORKFLOW_TEMPLATES.items():
        issue_type = issue_types.filter(
            project_id=project.id,
            name=type_name,
            level="task",
        ).first()
        if issue_type is None:
            continue

        update_fields = []
        start_state = states[template["start"]]
        if issue_type.start_state_id != start_state.id:
            issue_type.start_state_id = start_state.id
            update_fields.append("start_state")
        if issue_type.workflow_revision == 0:
            issue_type.workflow_revision = 1
            update_fields.append("workflow_revision")
        if update_fields:
            issue_type.save(using=alias, update_fields=update_fields)

        desired_edges = {
            (states[source].id, states[target].id): template[
                "agent_allowed"
            ].get((source, target), True)
            for source, targets in template["transitions"].items()
            for target in targets
        }
        canonical_edges = transitions.filter(
            issue_type_id=issue_type.id,
            from_state_id__in=canonical_state_ids,
            to_state_id__in=canonical_state_ids,
        )
        for edge in canonical_edges:
            key = (edge.from_state_id, edge.to_state_id)
            if key not in desired_edges:
                edge.delete(using=alias)
                continue
            expected_agent_allowed = desired_edges.pop(key)
            if edge.agent_allowed != expected_agent_allowed:
                edge.agent_allowed = expected_agent_allowed
                edge.save(using=alias, update_fields=["agent_allowed"])

        transitions.bulk_create(
            IssueTypeTransition(
                issue_type_id=issue_type.id,
                from_state_id=source_id,
                to_state_id=target_id,
                agent_allowed=agent_allowed,
            )
            for (source_id, target_id), agent_allowed in desired_edges.items()
        )


def _sync_launch_bindings(
    project,
    states,
    IssueType,
    LaunchBinding,
    alias,
):
    issue_types = IssueType.objects.using(alias)
    bindings = LaunchBinding.objects.using(alias)
    for issue_type in issue_types.filter(
        project_id=project.id,
        name__in=DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE,
        level="task",
    ):
        for state_name, state in states.items():
            reviewed_prompt = DEFAULT_AGENT_PROMPTS_BY_ISSUE_TYPE[issue_type.name][
                state_name
            ]
            binding, created = bindings.get_or_create(
                issue_type_id=issue_type.id,
                state_id=state.id,
                defaults={
                    "prompt": reviewed_prompt,
                    "required_skills": list(
                        DEFAULT_REQUIRED_SKILLS.get(state_name, ())
                    ),
                    "agent": None,
                    "model": None,
                    "reasoning": None,
                    "auto_start": DEFAULT_AUTO_START_BY_STATE.get(
                        state_name,
                        False,
                    ),
                    "subtree_run_enabled": issue_type.name == "Story",
                },
            )
            if created:
                continue

            update_fields = []
            previous_prompt = PREVIOUS_DEFAULT_PROMPTS_BY_STATE.get(state_name)
            if previous_prompt is not None and binding.prompt == previous_prompt:
                binding.prompt = reviewed_prompt
                update_fields.append("prompt")

            expected_skills = list(DEFAULT_REQUIRED_SKILLS.get(state_name, ()))
            if binding.required_skills != expected_skills:
                binding.required_skills = expected_skills
                update_fields.append("required_skills")
            expected_auto_start = DEFAULT_AUTO_START_BY_STATE.get(state_name, False)
            if binding.auto_start != expected_auto_start:
                binding.auto_start = expected_auto_start
                update_fields.append("auto_start")
            expected_subtree_run = issue_type.name == "Story"
            if binding.subtree_run_enabled != expected_subtree_run:
                binding.subtree_run_enabled = expected_subtree_run
                update_fields.append("subtree_run_enabled")
            if update_fields:
                binding.save(using=alias, update_fields=update_fields)


def migrate_matt_style_workflow(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    State = apps.get_model("worktracker", "State")
    Issue = apps.get_model("worktracker", "Issue")
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias if schema_editor is not None else "default"

    for project in Project.objects.using(alias).all().order_by("id"):
        states = _canonical_states(project, State, alias)
        _retire_ready(project, states, Issue, State, alias)
        _rebuild_type_workflows(
            project,
            states,
            IssueType,
            IssueTypeTransition,
            alias,
        )
        _sync_launch_bindings(
            project,
            states,
            IssueType,
            LaunchBinding,
            alias,
        )


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0029_sync_reviewed_launch_prompts")]

    operations = [
        migrations.RunPython(
            migrate_matt_style_workflow,
            migrations.RunPython.noop,
        )
    ]
