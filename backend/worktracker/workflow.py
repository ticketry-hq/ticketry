"""Persisted workflow graph enforcement.

The active revision of an issue type is the only transition authority.  Drafts
are intentionally ignored here: an administrator can experiment without
changing creation or transition behaviour until publication succeeds.
"""

from contextlib import contextmanager
from threading import RLock

from django.db import connections, transaction
from django.db.models import Q
from django.db.models.functions import Collate

from worktracker.models import Issue, IssueType, IssueTypeTransition, Project, State
from worktracker.ranking import key_between
from worktracker.services.errors import ValidationError
from worktracker.work_items import cascade_archive, default_state_id


_SQLITE_TRANSITION_LOCK = RLock()


@contextmanager
def _transition_transaction(using):
    connection = connections[using]
    if connection.vendor != "sqlite":
        with transaction.atomic(using=using):
            yield
        return

    # SQLite has no row-level lock, and a deferred transaction cannot safely
    # upgrade after two arrivals have read the same destination tail. Serialize
    # threads in this process and reserve the database writer before any reads;
    # BEGIN IMMEDIATE also covers another process using the same database file.
    with _SQLITE_TRANSITION_LOCK:
        previous_mode = connection.transaction_mode
        if not connection.in_atomic_block:
            connection.transaction_mode = "IMMEDIATE"
        try:
            with transaction.atomic(using=using):
                yield
        finally:
            connection.transaction_mode = previous_mode


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

    using = issue._state.db or "default"
    with _transition_transaction(using):
        Project.objects.select_for_update().only("id").get(pk=issue.project_id)
        if issue.type == "task":
            rank_collation = "BINARY" if connections[using].vendor == "sqlite" else "C"
            destination_tail = (
                Issue.objects.filter(
                    project_id=issue.project_id,
                    type="task",
                    state_id=target.id,
                    is_archived=False,
                )
                .exclude(pk=issue.pk)
                .alias(_ascii_rank=Collate("rank", rank_collation))
                .order_by("-_ascii_rank", "-sequence_id", "-id")
                .first()
            )
            if destination_tail is not None:
                successor_rank = (
                    Issue.objects.filter(
                        project_id=issue.project_id,
                        type="task",
                        is_archived=False,
                    )
                    .exclude(pk=issue.pk)
                    .alias(_ascii_rank=Collate("rank", rank_collation))
                    .filter(_ascii_rank__gt=destination_tail.rank)
                    .order_by("_ascii_rank", "sequence_id", "id")
                    .values_list("rank", flat=True)
                    .first()
                )
                issue.rank = key_between(
                    destination_tail.rank or None,
                    successor_rank,
                )

        old_group = issue.state.group if issue.state_id else None
        new_group = target.group
        issue.state = target
        cascade = old_group != "cancelled" and new_group == "cancelled"
        if cascade:
            issue.is_archived = True
        elif old_group == "cancelled" and new_group != "cancelled":
            issue.is_archived = False
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
