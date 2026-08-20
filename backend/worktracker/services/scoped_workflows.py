"""Immediately-live, revision-guarded edits to one issue type's workflow."""

from __future__ import annotations

from collections import defaultdict, deque

from django.db import transaction

from worktracker.models import IssueType, IssueTypeTransition, LaunchBinding, State
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError


def _issue_type(type_id) -> IssueType:
    try:
        return IssueType.objects.get(pk=type_id)
    except IssueType.DoesNotExist as exc:
        raise NotFoundError("Work-item type not found.") from exc


def _locked_issue_type(type_id, workflow_revision: int) -> IssueType:
    try:
        issue_type = IssueType.objects.select_for_update().get(pk=type_id)
    except IssueType.DoesNotExist as exc:
        raise NotFoundError("Work-item type not found.") from exc
    if issue_type.workflow_revision != workflow_revision:
        raise ConflictError(
            "Workflow revision is stale; read the current workflow and retry."
        )
    return issue_type


def _state(issue_type: IssueType, state_id, *, field: str = "state") -> State:
    try:
        return State.objects.get(pk=state_id, project_id=issue_type.project_id)
    except State.DoesNotExist as exc:
        raise ValidationError(
            f"{field.replace('_', ' ').capitalize()} does not belong to this project."
        ) from exc


def _advance_revision(issue_type: IssueType) -> None:
    issue_type.workflow_revision += 1
    issue_type.save(update_fields=["workflow_revision", "updated_at"])


def _reachable(seed_ids: set, edges) -> set:
    outgoing = defaultdict(set)
    for from_id, to_id in edges:
        outgoing[from_id].add(to_id)
    reachable = set(seed_ids)
    queue = deque(reachable)
    while queue:
        current = queue.popleft()
        for target in outgoing[current] - reachable:
            reachable.add(target)
            queue.append(target)
    return reachable


def _reachable_state_ids(start_state_id, transitions) -> set:
    if start_state_id is None:
        return set()
    return _reachable(
        {start_state_id},
        ((edge.from_state_id, edge.to_state_id) for edge in transitions),
    )


def _transition_payload(edge):
    return {
        "from_state_id": edge.from_state_id,
        "to_state_id": edge.to_state_id,
        "agent_allowed": edge.agent_allowed,
    }


def _launch_binding_payload(binding):
    return {
        "state_id": binding.state_id,
        "prompt": binding.prompt,
        "required_skills": binding.required_skills,
        "entry_skill": binding.entry_skill,
        "agent": binding.provider_slug,
        "model": binding.model_name,
        "reasoning": binding.reasoning_name,
        "auto_start": binding.auto_start,
        "subtree_run_enabled": binding.subtree_run_enabled,
    }


def _prune_impact(
    issue_type: IssueType,
    *,
    operation: str,
    state_id=None,
    from_state_id=None,
    to_state_id=None,
):
    transitions = list(
        IssueTypeTransition.objects.filter(issue_type=issue_type)
        .select_related("from_state", "to_state")
        .order_by("from_state__sort_order", "to_state__sort_order", "id")
    )
    bindings = list(
        LaunchBinding.objects.filter(issue_type=issue_type)
        .select_related("state")
        .order_by("state__sort_order", "id")
    )

    removed_edge_ids = set()
    next_start_state_id = issue_type.start_state_id
    if operation == "remove_state":
        state = _state(issue_type, state_id)
        if state.id == issue_type.start_state_id:
            raise ValidationError(
                "The workflow start state cannot be removed; change the start state instead."
            )
        removed_edge_ids = {
            edge.id
            for edge in transitions
            if state.id in {edge.from_state_id, edge.to_state_id}
        }
    elif operation == "remove_transition":
        _state(issue_type, from_state_id, field="from_state")
        _state(issue_type, to_state_id, field="to_state")
        matching = [
            edge
            for edge in transitions
            if edge.from_state_id == from_state_id and edge.to_state_id == to_state_id
        ]
        if not matching:
            raise NotFoundError("Workflow transition not found.")
        removed_edge_ids = {edge.id for edge in matching}
    elif operation == "set_start_state":
        next_start_state_id = _state(issue_type, state_id).id
    else:
        raise ValidationError("Unsupported workflow impact operation.")

    remaining = [edge for edge in transitions if edge.id not in removed_edge_ids]
    reachable = _reachable_state_ids(next_start_state_id, remaining)
    deleted_transitions = [
        edge
        for edge in transitions
        if edge.id in removed_edge_ids
        or edge.from_state_id not in reachable
        or edge.to_state_id not in reachable
    ]
    deleted_bindings = [
        binding for binding in bindings if binding.state_id not in reachable
    ]
    return {
        "deleted_transition_rows": deleted_transitions,
        "deleted_binding_rows": deleted_bindings,
    }


def _delete_impact_rows(impact) -> None:
    transition_ids = [edge.id for edge in impact["deleted_transition_rows"]]
    binding_ids = [binding.id for binding in impact["deleted_binding_rows"]]
    if transition_ids:
        IssueTypeTransition.objects.filter(id__in=transition_ids).delete()
    if binding_ids:
        LaunchBinding.objects.filter(id__in=binding_ids).delete()


def _standing_warnings(issue_type: IssueType, states, transitions):
    state_ids = {state.id for state in states}

    if issue_type.start_state_id not in state_ids:
        return [
            {
                "code": "start_state_not_configured",
                "state_id": None,
                "message": "No start state is configured for this work-item type.",
            }
        ]

    members = _reachable(
        {issue_type.start_state_id},
        ((edge.from_state_id, edge.to_state_id) for edge in transitions),
    )

    member_states = [state for state in states if state.id in members]
    completed = {state.id for state in member_states if state.group == "completed"}
    can_reach_completed = _reachable(
        completed,
        (
            (edge.to_state_id, edge.from_state_id)
            for edge in transitions
            if edge.from_state_id in members and edge.to_state_id in members
        ),
    )
    warnings = []
    for state in member_states:
        if state.id not in can_reach_completed:
            warnings.append(
                {
                    "code": "no_path_to_completed",
                    "state_id": state.id,
                    "message": f"{state.name} has no path to a completed state.",
                }
            )
    return warnings


def _launch_policy_warnings(bindings, states):
    """Report bindings the *current* host catalog would refuse at launch time.

    Activation and the global launch default live in host settings and are read
    live at launch, so a Settings change can invalidate a binding that was
    valid when it was written — with nothing on the workflow editor to say so.
    These two warnings surface that blast radius standing, rather than one
    failed launch at a time.
    """

    from apps.settings_store.provider_catalog import load_provider_catalog
    from worktracker.required_skills import USER_INVOKE_ONLY_SKILL_IDS
    from worktracker.services.provider_catalog import activated_provider_slugs

    catalog = load_provider_catalog()
    activated_providers = activated_provider_slugs()
    state_names = {state.id: state.name for state in states}
    warnings = []
    for binding in bindings:
        if not binding.has_launch_policy:
            continue
        state_name = state_names.get(binding.state_id, "This state")
        misplaced_entry_skills = [
            skill
            for skill in binding.required_skills
            if skill in USER_INVOKE_ONLY_SKILL_IDS and skill != binding.entry_skill
        ]
        if misplaced_entry_skills:
            skills = ", ".join(misplaced_entry_skills)
            warnings.append(
                {
                    "code": "user_invoke_only_skill_not_entry",
                    "state_id": binding.state_id,
                    "message": (
                        f"{state_name} requires {skills}, but user-invoke-only "
                        "skills must be selected as the entry skill."
                    ),
                }
            )
        if (
            binding.provider_slug is not None
            and binding.provider_slug not in activated_providers
        ):
            warnings.append(
                {
                    "code": "provider_not_activated",
                    "state_id": binding.state_id,
                    "message": (
                        f"{state_name} launches with {binding.provider_slug}, which is "
                        "deactivated in Settings → Model configuration; those "
                        "launches are blocked."
                    ),
                }
            )
        elif (
            binding.auto_start
            and binding.provider_slug is None
            and catalog.global_default is None
        ):
            warnings.append(
                {
                    "code": "auto_start_without_default",
                    "state_id": binding.state_id,
                    "message": (
                        f"{state_name} auto-starts through the global launch "
                        "default, and none is configured."
                    ),
                }
            )
    return warnings


def get_workflow(type_id):
    issue_type = _issue_type(type_id)
    states = list(
        State.objects.filter(project_id=issue_type.project_id).order_by(
            "sort_order", "created_at"
        )
    )
    transitions = list(
        IssueTypeTransition.objects.filter(issue_type=issue_type)
        .select_related("from_state", "to_state")
        .order_by("from_state__sort_order", "to_state__sort_order", "id")
    )
    bindings = list(
        LaunchBinding.objects.filter(issue_type=issue_type)
        .select_related("state")
        .order_by("state__sort_order", "id")
    )
    return {
        "issue_type_id": issue_type.id,
        "start_state_id": issue_type.start_state_id,
        "workflow_revision": issue_type.workflow_revision,
        "transitions": [_transition_payload(edge) for edge in transitions],
        "launch_bindings": [_launch_binding_payload(binding) for binding in bindings],
        "warnings": [
            *_standing_warnings(issue_type, states, transitions),
            *_launch_policy_warnings(bindings, states),
        ],
    }


def list_transitions(type_id):
    """Return one issue type's transition rows in canonical display order."""

    issue_type = _issue_type(type_id)
    return IssueTypeTransition.objects.filter(issue_type=issue_type).order_by(
        "from_state__sort_order", "to_state__sort_order", "id"
    )


@transaction.atomic
def add_transition(
    type_id,
    *,
    from_state_id,
    to_state_id,
    agent_allowed: bool,
    workflow_revision: int,
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    from_state = _state(issue_type, from_state_id, field="from_state")
    to_state = _state(issue_type, to_state_id, field="to_state")
    if from_state.id == to_state.id:
        raise ValidationError("A workflow transition must change state.")
    if IssueTypeTransition.objects.filter(
        issue_type=issue_type, from_state=from_state, to_state=to_state
    ).exists():
        raise ConflictError("That workflow transition already exists.")
    edge = IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=from_state,
        to_state=to_state,
        agent_allowed=agent_allowed,
    )
    _advance_revision(issue_type)
    return edge


@transaction.atomic
def remove_transition(type_id, from_state_id, to_state_id, *, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    impact = _prune_impact(
        issue_type,
        operation="remove_transition",
        from_state_id=from_state_id,
        to_state_id=to_state_id,
    )
    _delete_impact_rows(impact)
    _advance_revision(issue_type)


@transaction.atomic
def remove_state(type_id, state_id, *, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    impact = _prune_impact(
        issue_type,
        operation="remove_state",
        state_id=state_id,
    )
    _delete_impact_rows(impact)
    _advance_revision(issue_type)


@transaction.atomic
def set_transition_permission(
    type_id,
    from_state_id,
    to_state_id,
    *,
    agent_allowed: bool,
    workflow_revision: int,
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    _state(issue_type, from_state_id, field="from_state")
    _state(issue_type, to_state_id, field="to_state")
    try:
        edge = IssueTypeTransition.objects.get(
            issue_type=issue_type,
            from_state_id=from_state_id,
            to_state_id=to_state_id,
        )
    except IssueTypeTransition.DoesNotExist as exc:
        raise NotFoundError("Workflow transition not found.") from exc
    edge.agent_allowed = agent_allowed
    edge.save(update_fields=["agent_allowed"])
    _advance_revision(issue_type)
    return edge


@transaction.atomic
def set_start_state(type_id, *, state_id, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    impact = _prune_impact(
        issue_type,
        operation="set_start_state",
        state_id=state.id,
    )
    issue_type.start_state = state
    _delete_impact_rows(impact)
    issue_type.workflow_revision += 1
    issue_type.save(update_fields=["start_state", "workflow_revision", "updated_at"])
    return issue_type
