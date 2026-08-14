from django.db import migrations
from django.db.models import Q


IDEAS_NAME = "Ideas"
IDEAS_GROUP = "backlog"
IDEAS_COLOR = "#D12771"

CANONICAL_STATE_ORDER = (
    "Ideas",
    "Grill",
    "Spec",
    "Tickets",
    "Implement",
    "Review",
    "Done",
    "Cancelled",
)


def _merge_transitions(singular, ideas, IssueTypeTransition, alias):
    transitions = IssueTypeTransition.objects.using(alias)
    related = list(
        transitions.filter(
            Q(from_state_id=singular.id) | Q(to_state_id=singular.id)
        ).order_by("id")
    )
    for edge in related:
        from_state_id = (
            ideas.id if edge.from_state_id == singular.id else edge.from_state_id
        )
        to_state_id = ideas.id if edge.to_state_id == singular.id else edge.to_state_id
        if from_state_id == to_state_id:
            edge.delete(using=alias)
            continue

        existing = (
            transitions.filter(
                issue_type_id=edge.issue_type_id,
                from_state_id=from_state_id,
                to_state_id=to_state_id,
            )
            .exclude(pk=edge.pk)
            .first()
        )
        if existing is not None:
            if edge.agent_allowed and not existing.agent_allowed:
                existing.agent_allowed = True
                existing.save(using=alias, update_fields=["agent_allowed"])
            edge.delete(using=alias)
            continue

        edge.from_state_id = from_state_id
        edge.to_state_id = to_state_id
        edge.save(using=alias, update_fields=["from_state", "to_state"])


def _merge_launch_bindings(singular, ideas, LaunchBinding, alias):
    bindings = LaunchBinding.objects.using(alias)
    for binding in list(bindings.filter(state_id=singular.id).order_by("id")):
        existing = (
            bindings.filter(
                issue_type_id=binding.issue_type_id,
                state_id=ideas.id,
            )
            .exclude(pk=binding.pk)
            .first()
        )
        if existing is not None:
            # Ideas is the current canonical state. If both rows have policy,
            # keep its policy rather than reviving stale singular-state config.
            binding.delete(using=alias)
            continue
        binding.state_id = ideas.id
        binding.save(using=alias, update_fields=["state"])


def _merge_singular_state(
    singular,
    ideas,
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    alias,
):
    Issue.objects.using(alias).filter(state_id=singular.id).update(state_id=ideas.id)
    IssueType.objects.using(alias).filter(start_state_id=singular.id).update(
        start_state_id=ideas.id
    )
    _merge_transitions(singular, ideas, IssueTypeTransition, alias)
    _merge_launch_bindings(singular, ideas, LaunchBinding, alias)
    singular.delete(using=alias)


def merge_singular_idea_state(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    State = apps.get_model("worktracker", "State")
    Issue = apps.get_model("worktracker", "Issue")
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias

    for project in Project.objects.using(alias).all().order_by("id"):
        states = State.objects.using(alias).filter(project_id=project.id)
        ideas = states.filter(name=IDEAS_NAME).order_by("id").first()
        singular_states = list(states.filter(name="Idea").order_by("id"))

        if ideas is None and singular_states:
            ideas = singular_states.pop(0)
            ideas.name = IDEAS_NAME

        if ideas is None:
            continue

        ideas.group = IDEAS_GROUP
        ideas.color = IDEAS_COLOR
        ideas.sort_order = 0
        ideas.is_protected = True
        ideas.save(
            using=alias,
            update_fields=["name", "group", "color", "sort_order", "is_protected"],
        )

        for singular in singular_states:
            _merge_singular_state(
                singular,
                ideas,
                Issue,
                IssueType,
                IssueTypeTransition,
                LaunchBinding,
                alias,
            )

        IssueType.objects.using(alias).filter(
            project_id=project.id,
            name="Story",
            level="task",
        ).exclude(start_state_id=ideas.id).update(start_state_id=ideas.id)

        for sort_order, name in enumerate(CANONICAL_STATE_ORDER):
            states.filter(name=name).update(sort_order=sort_order)


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0041_project_manual_module_order")]

    operations = [
        migrations.RunPython(
            merge_singular_idea_state,
            migrations.RunPython.noop,
        )
    ]
