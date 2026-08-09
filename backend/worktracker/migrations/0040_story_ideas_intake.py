import uuid

from django.db import migrations


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

IDEAS_PROMPTS = {
    "Story": "This Story is in `Ideas`. Gather enough context to decide whether it needs an interactive grill session or can proceed through the normal delivery workflow. Read the title, description, attachments, linked material, and relevant repository context. If essential product or behavior decisions are missing or ambiguous, move the Story to `Grill` using the MCP server and stop without inventing those decisions. If the available context is sufficient, move the Story to `Spec` using the MCP server so the normal Spec, Tickets, and Implement pipeline can continue. Do not implement the work, create implementation tickets, or bypass the workflow while in `Ideas`. After making the transition, terminate the current agent session using the MCP server.",
    "PathFind": "This PathFind work item is in `Ideas`, which is not part of the reviewed PathFind workflow. Do not mutate the work item or begin an investigation. Report the workflow mismatch and terminate the current agent session using the MCP server.",
    "Implementation": "This Implementation work item is in `Ideas`, which is not part of the reviewed Implementation workflow. Do not mutate the work item or begin implementation. Report the workflow mismatch and terminate the current agent session using the MCP server.",
}

PREVIOUS_IDEA_PROMPTS = {
    issue_type: prompt.replace("`Ideas`", "`Idea`")
    for issue_type, prompt in IDEAS_PROMPTS.items()
}


def _ideas_state(project, State, alias):
    states = State.objects.using(alias).filter(project_id=project.id)
    ideas = states.filter(name=IDEAS_NAME).order_by("id").first()
    if ideas is None:
        # A short-lived build seeded singular Idea as the protected intake state.
        # Preserve that row (and every FK to it) when upgrading that build.
        ideas = (
            states.filter(name="Idea", group=IDEAS_GROUP, is_protected=True)
            .order_by("id")
            .first()
        )
        if ideas is not None:
            ideas.name = IDEAS_NAME
        else:
            ideas = State(
                id=uuid.uuid4(),
                project_id=project.id,
                name=IDEAS_NAME,
            )

    ideas.group = IDEAS_GROUP
    ideas.color = IDEAS_COLOR
    ideas.sort_order = 0
    ideas.is_protected = True
    ideas.save(using=alias)
    return ideas


def _order_canonical_states(project, State, alias):
    for sort_order, name in enumerate(CANONICAL_STATE_ORDER):
        State.objects.using(alias).filter(
            project_id=project.id,
            name=name,
        ).update(sort_order=sort_order)


def _sync_ideas_binding(issue_type, ideas, LaunchBinding, alias):
    bindings = LaunchBinding.objects.using(alias)
    binding, created = bindings.get_or_create(
        issue_type_id=issue_type.id,
        state_id=ideas.id,
        defaults={
            "prompt": IDEAS_PROMPTS[issue_type.name],
            "required_skills": [],
            "model_id": None,
            "reasoning_id": None,
            "auto_start": True,
            "subtree_run_enabled": False,
        },
    )
    if created:
        return

    update_fields = []
    if binding.prompt == PREVIOUS_IDEA_PROMPTS[issue_type.name]:
        binding.prompt = IDEAS_PROMPTS[issue_type.name]
        update_fields.append("prompt")
    if binding.required_skills:
        binding.required_skills = []
        update_fields.append("required_skills")
    if not binding.auto_start:
        binding.auto_start = True
        update_fields.append("auto_start")
    if binding.subtree_run_enabled:
        binding.subtree_run_enabled = False
        update_fields.append("subtree_run_enabled")
    if update_fields:
        binding.save(using=alias, update_fields=update_fields)


def add_story_ideas_intake(apps, schema_editor):
    Project = apps.get_model("worktracker", "Project")
    State = apps.get_model("worktracker", "State")
    IssueType = apps.get_model("worktracker", "IssueType")
    IssueTypeTransition = apps.get_model("worktracker", "IssueTypeTransition")
    LaunchBinding = apps.get_model("worktracker", "LaunchBinding")
    alias = schema_editor.connection.alias

    for project in Project.objects.using(alias).all().order_by("id"):
        ideas = _ideas_state(project, State, alias)
        _order_canonical_states(project, State, alias)

        canonical_types = IssueType.objects.using(alias).filter(
            project_id=project.id,
            name__in=IDEAS_PROMPTS,
            level="task",
        )
        for issue_type in canonical_types:
            _sync_ideas_binding(issue_type, ideas, LaunchBinding, alias)

        story = canonical_types.filter(name="Story").first()
        if story is None:
            continue
        if story.start_state_id != ideas.id:
            story.start_state_id = ideas.id
            story.save(using=alias, update_fields=["start_state"])

        states = {
            state.name: state
            for state in State.objects.using(alias).filter(
                project_id=project.id,
                name__in=("Ideas", "Grill", "Spec"),
            )
        }
        if not {"Ideas", "Grill", "Spec"}.issubset(states):
            continue
        for source, target in (
            ("Ideas", "Grill"),
            ("Ideas", "Spec"),
            ("Grill", "Ideas"),
        ):
            edge, created = IssueTypeTransition.objects.using(alias).get_or_create(
                issue_type_id=story.id,
                from_state_id=states[source].id,
                to_state_id=states[target].id,
                defaults={"agent_allowed": True},
            )
            if not created and not edge.agent_allowed:
                edge.agent_allowed = True
                edge.save(using=alias, update_fields=["agent_allowed"])


class Migration(migrations.Migration):
    dependencies = [("worktracker", "0039_issue_type_pathfind_role")]

    operations = [
        migrations.RunPython(
            add_story_ideas_intake,
            migrations.RunPython.noop,
        )
    ]
