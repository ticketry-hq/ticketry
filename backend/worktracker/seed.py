"""Shared project-row materializers for reviewed and canonical defaults.

Workflow graphs, launch prompts, state and issue-type vocabulary, and default
skill requirements all enter through ``worktracker/reviewed_defaults.json``.
The project-create route and data migration backfills call into these helpers
so project-owned defaults are written once. Each helper takes its model class
explicitly — passing
``apps.get_model(...)`` from a migration or the live model from the service —
so the logic is identical in both worlds. Every helper is idempotent: a second
run changes nothing.
"""

import uuid

from worktracker.models import (
    DEFAULT_ISSUE_TYPES,
    DEFAULT_STATES,
    PROTECTED_STATE_KEYS,
)
from worktracker.launch_seeds import (
    DEFAULT_AUTO_START_BY_STATE,
    default_agent_prompt,
)
from worktracker.required_skills import DEFAULT_REQUIRED_SKILLS
from worktracker.workflow_seeds import DEFAULT_WORKFLOW_TEMPLATES


def ensure_issue_types(project, IssueType, Issue=None):
    """Ensure the project's four canonical issue types exist (CODIN-859/954).

    Reconciles the exact legacy module-level ``Epic`` type to ``Module``, then
    seeds Module (module) + Story, PathFind, Implementation (task) in
    :data:`DEFAULT_ISSUE_TYPES` order. Idempotent.

    :param project: the project (live or historical instance).
    :param IssueType: the IssueType model class (live or historical).
    :param Issue: the Issue model class when reconciling a legacy collision.
        Required only when a project already has both Epic and Module rows.
    """

    if Issue is None:
        # Live callers should not need to know that collision reconciliation
        # also touches issues. Historical migrations pass their frozen model.
        from worktracker.models import Issue as LiveIssue

        Issue = LiveIssue
    _reconcile_legacy_module_type(project, IssueType, Issue)

    for order, (name, level) in enumerate(DEFAULT_ISSUE_TYPES):
        IssueType.objects.get_or_create(
            project=project,
            name=name,
            defaults={
                "id": uuid.uuid4(),
                "level": level,
                "sort_order": order,
            },
        )


def ensure_launch_bindings(project, IssueType, State, LaunchBinding):
    """Write the reviewed launch defaults as explicit project policy rows.

    Only canonical task types and canonical states are selected. Custom types
    and states are deliberately ignored, and existing rows are never replaced.
    """

    task_type_names = [
        name for name, level in DEFAULT_ISSUE_TYPES if level == "task"
    ]
    state_names = [name for name, _group, _color in DEFAULT_STATES]
    issue_types = IssueType.objects.filter(
        project=project, name__in=task_type_names, level="task"
    )
    states = State.objects.filter(project=project, name__in=state_names)
    supports_subtree_run = any(
        field.name == "subtree_run_enabled"
        for field in LaunchBinding._meta.get_fields()
    )
    supports_required_skills = any(
        field.name == "required_skills"
        for field in LaunchBinding._meta.get_fields()
    )
    supports_auto_start = any(
        field.name == "auto_start" for field in LaunchBinding._meta.get_fields()
    )
    for issue_type in issue_types:
        for state in states:
            defaults = {
                "prompt": default_agent_prompt(issue_type.name, state.name),
                "agent": None,
                "model": None,
                "reasoning": None,
            }
            if supports_subtree_run:
                defaults["subtree_run_enabled"] = issue_type.name == "Story"
            if supports_required_skills:
                defaults["required_skills"] = list(
                    DEFAULT_REQUIRED_SKILLS.get(state.name, ())
                )
            if supports_auto_start:
                defaults["auto_start"] = DEFAULT_AUTO_START_BY_STATE.get(
                    state.name, False
                )
            LaunchBinding.objects.get_or_create(
                issue_type=issue_type,
                state=state,
                defaults=defaults,
            )


def ensure_type_workflows(project, IssueType, State, IssueTypeTransition):
    """Materialize canonical routes directly into the live per-type model."""

    states = {state.name: state for state in State.objects.filter(project=project)}
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

        start_state = states[template["start"]]
        update_fields = []
        if issue_type.start_state_id != start_state.id:
            issue_type.start_state = start_state
            update_fields.append("start_state")
        if issue_type.workflow_revision == 0:
            issue_type.workflow_revision = 1
            update_fields.append("workflow_revision")
        if update_fields:
            issue_type.save(update_fields=[*update_fields, "updated_at"])

        for source, targets in transitions.items():
            for target in targets:
                IssueTypeTransition.objects.get_or_create(
                    issue_type=issue_type,
                    from_state=states[source],
                    to_state=states[target],
                    defaults={
                        "agent_allowed": template["agent_allowed"].get(
                            (source, target), True
                        )
                    },
                )


def _reconcile_legacy_module_type(project, IssueType, Issue):
    """Rename a legacy module Epic, or fold it into an existing Module row.

    The ``(project, name)`` uniqueness constraint means a direct rename is safe
    only when Module does not yet exist. In a collision, every Issue reference
    moves to Module before Epic is deleted, preserving module identities,
    parentage, and memberships.
    """

    epic = IssueType.objects.filter(
        project=project, name="Epic", level="module"
    ).first()
    if epic is None:
        return

    module = IssueType.objects.filter(
        project=project, name="Module", level="module"
    ).first()
    if module is None:
        epic.name = "Module"
        epic.save(update_fields=["name"])
        return

    if Issue is None:
        raise RuntimeError("Issue model is required to reconcile Epic/Module collision")
    Issue.objects.filter(project=project, issue_type=epic).update(issue_type=module)
    epic.delete()


def ensure_state_order(project, State):
    """Stamp ``sort_order`` on the project's states in canonical workflow order.

    States are ranked by their *name's* position in :data:`DEFAULT_STATES` (so
    Spec precedes Tickets and Implement precedes Review even though each pair
    shares a group). Non-canonical/custom states fall back to their group's rank
    and sort after all canonical states; ties break on ``created_at``. States are
    numbered ``0..n-1``; only rows whose order changes are written.

    :param project: the project (live or historical instance).
    :param State: the State model class (live or historical).
    """

    name_rank = {name: i for i, (name, *_) in enumerate(DEFAULT_STATES)}
    group_rank = {}
    for i, (_, group, *_) in enumerate(DEFAULT_STATES):
        group_rank.setdefault(group, i)

    def sort_key(state):
        if state.name in name_rank:
            return (0, name_rank[state.name], state.created_at)
        return (1, group_rank.get(state.group, len(DEFAULT_STATES)), state.created_at)

    states = sorted(State.objects.filter(project=project), key=sort_key)
    for index, state in enumerate(states):
        if state.sort_order != index:
            state.sort_order = index
            state.save(update_fields=["sort_order"])


def ensure_protected_states(project, State):
    """Stamp ``is_protected`` on the project's board-critical states (#629).

    Matches each state by ``(name, group)`` against :data:`PROTECTED_STATE_KEYS`
    and writes the flag only where it is not already set. Idempotent; never
    un-protects a row, and never touches a user-renamed state (its
    ``(name, group)`` no longer matches a seeded key).

    :param project: the project (live or historical instance).
    :param State: the State model class (live or historical).
    """

    for state in State.objects.filter(project=project):
        if (state.name, state.group) in PROTECTED_STATE_KEYS and not state.is_protected:
            state.is_protected = True
            state.save(update_fields=["is_protected"])
