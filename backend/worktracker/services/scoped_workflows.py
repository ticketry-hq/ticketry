"""Immediately-live, revision-guarded edits to one issue type's workflow."""

from __future__ import annotations

from collections import defaultdict, deque

from django.db import transaction

from worktracker.models import IssueType, IssueTypeTransition, LaunchBinding, State
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError
from worktracker.services.launch_bindings import (
    validate_provider_options,
    validate_unattended_launch_binding,
)


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


def _check_revision(issue_type: IssueType, workflow_revision: int) -> None:
    if issue_type.workflow_revision != workflow_revision:
        raise ConflictError(
            "Workflow revision is stale; read the current workflow and retry."
        )


def _reachable_state_ids(start_state_id, transitions) -> set:
    if start_state_id is None:
        return set()
    outgoing = defaultdict(set)
    for edge in transitions:
        outgoing[edge.from_state_id].add(edge.to_state_id)
    reachable = {start_state_id}
    queue = deque(reachable)
    while queue:
        current = queue.popleft()
        for target in outgoing[current] - reachable:
            reachable.add(target)
            queue.append(target)
    return reachable


def _build_impact(
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
            if edge.from_state_id == from_state_id
            and edge.to_state_id == to_state_id
        ]
        if not matching:
            raise NotFoundError("Workflow transition not found.")
        removed_edge_ids = {edge.id for edge in matching}
    elif operation == "set_start_state":
        next_start_state_id = _state(issue_type, state_id).id
    else:
        raise ValidationError("Unsupported workflow impact operation.")

    remaining = [
        edge for edge in transitions if edge.id not in removed_edge_ids
    ]
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
        "workflow_revision": issue_type.workflow_revision,
        "deleted_transition_rows": deleted_transitions,
        "deleted_binding_rows": deleted_bindings,
        "deleted_transitions": [
            {
                "from_state_id": edge.from_state_id,
                "to_state_id": edge.to_state_id,
                "agent_allowed": edge.agent_allowed,
            }
            for edge in deleted_transitions
        ],
        "deleted_launch_bindings": [
            {
                "state_id": binding.state_id,
                "prompt": binding.prompt,
                "agent": binding.agent,
                "model": binding.model,
                "reasoning": binding.reasoning,
                "auto_start": binding.auto_start,
                "subtree_run_enabled": binding.subtree_run_enabled,
            }
            for binding in deleted_bindings
        ],
        "disabled_auto_start_state_ids": [
            binding.state_id for binding in deleted_bindings if binding.auto_start
        ],
    }


def _public_impact(impact):
    return {
        key: value
        for key, value in impact.items()
        if key not in {"deleted_transition_rows", "deleted_binding_rows"}
    }


def _delete_impact_rows(impact) -> None:
    transition_ids = [edge.id for edge in impact["deleted_transition_rows"]]
    binding_ids = [binding.id for binding in impact["deleted_binding_rows"]]
    if transition_ids:
        IssueTypeTransition.objects.filter(id__in=transition_ids).delete()
    if binding_ids:
        LaunchBinding.objects.filter(id__in=binding_ids).delete()


def preview_impact(
    type_id,
    *,
    operation: str,
    workflow_revision: int,
    state_id=None,
    from_state_id=None,
    to_state_id=None,
):
    issue_type = _issue_type(type_id)
    _check_revision(issue_type, workflow_revision)
    return _public_impact(
        _build_impact(
            issue_type,
            operation=operation,
            state_id=state_id,
            from_state_id=from_state_id,
            to_state_id=to_state_id,
        )
    )


def _standing_warnings(issue_type: IssueType, states, transitions):
    state_ids = {state.id for state in states}
    outgoing = defaultdict(set)
    for edge in transitions:
        outgoing[edge.from_state_id].add(edge.to_state_id)

    if issue_type.start_state_id not in state_ids:
        return [
            {
                "code": "start_state_not_configured",
                "state_id": None,
                "message": "No start state is configured for this work-item type.",
            }
        ]

    members = {issue_type.start_state_id}
    queue = deque(members)
    while queue:
        current = queue.popleft()
        for target in outgoing[current] - members:
            members.add(target)
            queue.append(target)

    member_states = [state for state in states if state.id in members]
    incoming = defaultdict(set)
    for edge in transitions:
        if edge.from_state_id in members and edge.to_state_id in members:
            incoming[edge.to_state_id].add(edge.from_state_id)

    completed = {
        state.id for state in member_states if state.group == "completed"
    }
    can_reach_completed = set(completed)
    queue = deque(completed)
    while queue:
        current = queue.popleft()
        for source in incoming[current] - can_reach_completed:
            can_reach_completed.add(source)
            queue.append(source)
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
        "transitions": [
            {
                "from_state_id": edge.from_state_id,
                "to_state_id": edge.to_state_id,
                "agent_allowed": edge.agent_allowed,
            }
            for edge in transitions
        ],
        "launch_bindings": [
            {
                "state_id": binding.state_id,
                "prompt": binding.prompt,
                "agent": binding.agent,
                "model": binding.model,
                "reasoning": binding.reasoning,
                "auto_start": binding.auto_start,
                "subtree_run_enabled": binding.subtree_run_enabled,
            }
            for binding in bindings
        ],
        "warnings": _standing_warnings(issue_type, states, transitions),
    }


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
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=from_state,
        to_state=to_state,
        agent_allowed=agent_allowed,
    )
    _advance_revision(issue_type)
    return get_workflow(type_id)


@transaction.atomic
def remove_transition(
    type_id, from_state_id, to_state_id, *, workflow_revision: int
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    impact = _build_impact(
        issue_type,
        operation="remove_transition",
        from_state_id=from_state_id,
        to_state_id=to_state_id,
    )
    _delete_impact_rows(impact)
    _advance_revision(issue_type)
    return get_workflow(type_id)


@transaction.atomic
def remove_state(type_id, state_id, *, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    impact = _build_impact(
        issue_type,
        operation="remove_state",
        state_id=state_id,
    )
    _delete_impact_rows(impact)
    _advance_revision(issue_type)
    return get_workflow(type_id)


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
    return get_workflow(type_id)


@transaction.atomic
def set_start_state(type_id, *, state_id, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    impact = _build_impact(
        issue_type,
        operation="set_start_state",
        state_id=state.id,
    )
    issue_type.start_state = state
    _delete_impact_rows(impact)
    issue_type.workflow_revision += 1
    issue_type.save(
        update_fields=["start_state", "workflow_revision", "updated_at"]
    )
    return get_workflow(type_id)


@transaction.atomic
def upsert_launch_binding(
    type_id,
    state_id,
    *,
    prompt,
    agent,
    model,
    reasoning,
    workflow_revision: int,
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    agent, model, reasoning = validate_provider_options(
        agent=agent, model=model, reasoning=reasoning
    )
    current = LaunchBinding.objects.filter(
        issue_type=issue_type, state=state
    ).first()
    if current is not None and current.auto_start:
        proposed = LaunchBinding(
            issue_type=issue_type,
            state=state,
            prompt=prompt or "",
            agent=agent,
            model=model,
            reasoning=reasoning,
            auto_start=True,
        )
        validate_unattended_launch_binding(proposed)
    LaunchBinding.objects.update_or_create(
        issue_type=issue_type,
        state=state,
        defaults={
            "prompt": prompt or "",
            "agent": agent,
            "model": model,
            "reasoning": reasoning,
        },
    )
    _advance_revision(issue_type)
    return get_workflow(type_id)


@transaction.atomic
def clear_launch_binding(type_id, state_id, *, workflow_revision: int):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    binding = LaunchBinding.objects.filter(
        issue_type=issue_type, state=state
    ).first()
    if binding is not None and binding.subtree_run_enabled:
        binding.prompt = ""
        binding.agent = None
        binding.model = None
        binding.reasoning = None
        binding.auto_start = False
        binding.save(
            update_fields=[
                "prompt",
                "agent",
                "model",
                "reasoning",
                "auto_start",
                "updated_at",
            ]
        )
    elif binding is not None:
        binding.delete()
    _advance_revision(issue_type)
    return get_workflow(type_id)


@transaction.atomic
def set_auto_start(
    type_id, state_id, *, auto_start: bool, workflow_revision: int
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    try:
        binding = LaunchBinding.objects.get(issue_type=issue_type, state=state)
    except LaunchBinding.DoesNotExist as exc:
        raise ValidationError(
            "Configure a launch binding before changing auto-start."
        ) from exc
    if auto_start:
        validate_unattended_launch_binding(binding)
    binding.auto_start = auto_start
    binding.save(update_fields=["auto_start", "updated_at"])
    _advance_revision(issue_type)
    return get_workflow(type_id)


@transaction.atomic
def set_subtree_run(
    type_id, state_id, *, enabled: bool, workflow_revision: int
):
    issue_type = _locked_issue_type(type_id, workflow_revision)
    state = _state(issue_type, state_id, field="state")
    binding, _ = LaunchBinding.objects.get_or_create(
        issue_type=issue_type,
        state=state,
    )
    binding.subtree_run_enabled = enabled
    binding.save(update_fields=["subtree_run_enabled", "updated_at"])
    _advance_revision(issue_type)
    return get_workflow(type_id)
