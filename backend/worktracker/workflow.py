"""Persisted workflow graph enforcement.

The active revision of an issue type is the only transition authority.  Drafts
are intentionally ignored here: an administrator can experiment without
changing creation or transition behaviour until publication succeeds.
"""

from django.db import transaction
from django.db.models import Q

from worktracker.models import IssueType, IssueTypeTransition, State
from worktracker.services.errors import ValidationError
from worktracker.work_items import cascade_archive, default_state_id


class InvalidTransition(ValidationError):
    def __init__(self, message, *, code, from_state, to_state):
        super().__init__(message)
        self.code, self.from_state, self.to_state = code, from_state, to_state

    def as_body(self):
        return {"detail": self.message, "code": self.code, "from": self.from_state, "to": self.to_state}


def _graph_node_ids(issue_type_id):
    transitions = IssueTypeTransition.objects.filter(issue_type_id=issue_type_id)
    nodes = set(transitions.values_list("from_state_id", flat=True))
    nodes.update(transitions.values_list("to_state_id", flat=True))
    start_state_id = IssueType.objects.filter(pk=issue_type_id).values_list(
        "start_state_id", flat=True
    ).first()
    if start_state_id:
        nodes.add(start_state_id)
    return nodes


def allowed_transitions(issue):
    """Return per-type transition destinations as state names for presentation."""
    if not issue.state_id:
        return set()
    ids = IssueTypeTransition.objects.filter(
        issue_type_id=issue.issue_type_id, from_state_id=issue.state_id
    ).values_list("to_state_id", flat=True)
    return set(State.objects.filter(project_id=issue.project_id, id__in=ids).values_list("name", flat=True))


def resolve_birth_state(project_id, issue_type, state_id=None):
    """Use the explicitly selected issue type's start pointer for creation."""
    start_id = (
        IssueType.objects.filter(pk=issue_type.id)
        .values_list("start_state_id", flat=True)
        .first()
    )
    if not start_id:
        return state_id or default_state_id(project_id)
    start = State.objects.filter(pk=start_id, project_id=project_id).first()
    # An active revision must have been valid when published.  If an admin later
    # deletes a referenced state, fail safely rather than create an unroutable item.
    if start is None:
        raise InvalidTransition("The published workflow start state no longer exists.", code="invalid_workflow", from_state=None, to_state=None)
    if state_id is not None and str(state_id) != str(start.id):
        requested = State.objects.filter(pk=state_id, project_id=project_id).first()
        raise InvalidTransition(
            f"A {issue_type.name} is born in {start.name!r}; it cannot be created in another state.",
            code="illegal_birth", from_state=None,
            to_state=requested.name if requested else None,
        )
    return start.id


def transition_state(
    issue,
    target_state,
    *,
    origin="human",
):
    target = _resolve_target(issue, target_state)
    from_name = issue.state.name if issue.state_id else None
    to_name = target.name if target else None
    start_state_id = IssueType.objects.filter(pk=issue.issue_type_id).values_list(
        "start_state_id", flat=True
    ).first()

    if not start_state_id:
        raise InvalidTransition(
            f"A {issue.issue_type.name} cannot move {from_name!r} → {to_name!r}: "
            "its workflow has no configured transition graph.",
            code="illegal_transition",
            from_state=from_name,
            to_state=to_name,
        )

    if start_state_id:
        if issue.state_id is None or target is None:
            raise InvalidTransition("Published workflows require an explicit graph edge.", code="illegal_transition", from_state=from_name, to_state=to_name)
        nodes = _graph_node_ids(issue.issue_type_id)
        if target.id not in nodes:
            other_type_ids = IssueType.objects.filter(
                project_id=issue.project_id
            ).exclude(pk=issue.issue_type_id)
            target_used_elsewhere = other_type_ids.filter(
                Q(start_state_id=target.id)
                | Q(transitions__from_state_id=target.id)
                | Q(transitions__to_state_id=target.id)
            ).exists()
            code = (
                "foreign_state"
                if target_used_elsewhere
                else "unknown_state"
            )
            raise InvalidTransition(
                f"{target.name!r} is not a state in the published workflow.",
                code=code, from_state=from_name, to_state=to_name,
            )
        edge = IssueTypeTransition.objects.filter(
            issue_type_id=issue.issue_type_id,
            from_state_id=issue.state_id,
            to_state_id=target.id,
        ).first()
        if edge is None:
            raise InvalidTransition(
                f"A {issue.issue_type.name} cannot move {from_name!r} → {to_name!r}.",
                code="illegal_transition", from_state=from_name, to_state=to_name,
            )
        if origin == "agent" and not edge.agent_allowed:
            raise InvalidTransition(
                f"The {from_name!r} → {to_name!r} edge is a human-only transition; agents are not allowed to take it.",
                code="human_only_transition",
                from_state=from_name,
                to_state=to_name,
            )

    old_group, new_group = (issue.state.group if issue.state_id else None), (target.group if target else None)
    issue.state = target
    cascade = old_group != "cancelled" and new_group == "cancelled"
    if cascade:
        issue.is_archived = True
    elif old_group == "cancelled" and new_group != "cancelled":
        issue.is_archived = False
    with transaction.atomic():
        issue.save()
        if cascade:
            cascade_archive(issue)
    return issue


def _resolve_target(issue, target_state):
    if not target_state:
        return None
    state = State.objects.filter(pk=target_state, project_id=issue.project_id).first()
    if state is None:
        raise InvalidTransition(f"No such state {str(target_state)!r} in this project.", code="unknown_state", from_state=(issue.state.name if issue.state_id else None), to_state=None)
    return state
