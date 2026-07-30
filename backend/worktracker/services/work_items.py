"""Framework-neutral work item mutation services."""

import uuid

from django.db import transaction
from django.shortcuts import get_object_or_404

from worktracker.models import Issue, IssueType, Project, State
from worktracker.ranking import key_between
from worktracker.sequences import allocate_sequence_id
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError
from worktracker.work_items import (
    append_rank,
    apply_label_names,
    blocker_would_cycle,
    resolve_issue_type,
)
from worktracker.workflow import (
    InvalidTransition,
    resolve_birth_state,
    transition_state,
)


def create_project_work_item(
    project_id: uuid.UUID,
    *,
    name: str,
    issue_type_id=None,
    state_id=None,
    description=None,
    parent_id=None,
):
    """Create a project task and return the saved issue."""

    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist as exc:
        raise NotFoundError("Project not found.") from exc

    issue_type = resolve_issue_type(project.id, issue_type_id, "task")
    if issue_type_id and issue_type is None:
        raise ValidationError("Invalid issue type.")

    issue = Issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name=name,
        sequence_id=allocate_sequence_id(project.id),
        rank=append_rank(project.id),
    )

    if description is not None:
        # description_html is what every reader (API detail, MCP agent,
        # studio) surfaces; a create that only filled ``description``
        # looked like silent data loss (#775).
        issue.description = description
        issue.description_html = description
    if parent_id:
        issue.parent_id = parent_id
    # Birth is gated like the move is (#870): a typed item is born in its
    # type's birth state, and an explicit state_id may not override it.
    issue.state_id = resolve_birth_state(project.id, issue_type, state_id)
    issue.issue_type = issue_type

    with transaction.atomic():
        issue.save()

    return issue


#: The workflow stage a finding rejoins and the type it must carry. The actual
#: birth state is resolved through the Implementation type's published start
#: pointer, exactly as it is for every other Implementation child.
_FINDING_STAGE = "Implement"
_FINDING_TYPE = "Implementation"


def create_review_finding(
    project_id: uuid.UUID,
    *,
    parent_id: uuid.UUID,
    name: str,
    description: str,
    issue_type_id=None,
):
    """Create an Implementation finding under a Story in Review (#905).

    The dedicated, validated create the Story integration-review agent uses to
    turn a finding into a fresh Implementation child: the child is born in the
    Implementation workflow's start stage, typed ``Implementation``, and
    parented to a Story that is currently in ``Review``.

    Every parent / type / state / project precondition is checked **before any
    write**; a rejection raises :class:`~worktracker.workflow.InvalidTransition`
    so the caller receives the same machine-readable 422 body
    (``detail``/``code``/``from``/``to``) the workflow status gate emits. The
    ``issue_type_id`` argument is optional and, when present, must resolve to the
    project's ``Implementation`` type — a foreign type is rejected.

    Inert by contract: no agent launch, no parent state move, no scheduler, and
    no blocker/dependency edge — just the parented child. The actual write reuses
    :func:`create_project_work_item`, so description-html handling, rank, and
    sequence allocation stay identical to a generic create.
    """

    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist as exc:
        raise NotFoundError("Project not found.") from exc

    try:
        parent = Issue.objects.select_related("issue_type", "state").get(pk=parent_id)
    except Issue.DoesNotExist as exc:
        raise NotFoundError("Parent work item not found.") from exc

    parent_state = parent.state.name if parent.state_id else None

    if parent.project_id != project.id:
        raise InvalidTransition(
            "The finding's parent work item belongs to another project.",
            code="foreign_project",
            from_state=parent_state,
            to_state=_FINDING_STAGE,
        )

    parent_type = parent.issue_type.name if parent.issue_type_id else None
    if parent_type != "Story":
        raise InvalidTransition(
            "A review finding can only be created under a Story.",
            code="parent_not_story",
            from_state=parent_state,
            to_state=_FINDING_STAGE,
        )

    if parent_state != "Review":
        raise InvalidTransition(
            "A review finding's parent Story must be in Review.",
            code="parent_not_review",
            from_state=parent_state,
            to_state=_FINDING_STAGE,
        )

    impl_type = (
        IssueType.objects.filter(
            project_id=project.id, level="task", name=_FINDING_TYPE
        )
        .order_by("sort_order", "created_at")
        .first()
    )
    if impl_type is None:
        raise ValidationError(
            f"Project has no {_FINDING_TYPE!r} issue type to type the finding."
        )
    if issue_type_id is not None and str(issue_type_id) != str(impl_type.id):
        raise InvalidTransition(
            f"A review finding must be an {_FINDING_TYPE} child.",
            code="child_not_implementation",
            from_state=parent_state,
            to_state=_FINDING_STAGE,
        )

    return create_project_work_item(
        project.id,
        name=name,
        issue_type_id=impl_type.id,
        description=description,
        parent_id=parent.id,
    )


def create_module_work_item(
    module_id: uuid.UUID,
    *,
    name: str,
    issue_type_id=None,
    description=None,
):
    """Create a task under a module and return the saved issue."""

    module = get_object_or_404(Issue, pk=module_id)
    sequence_id = allocate_sequence_id(module.project_id)

    issue = Issue(
        id=uuid.uuid4(),
        project_id=module.project_id,
        type="task",
        name=name,
        sequence_id=sequence_id,
        parent=module,
        rank=append_rank(module.project_id),
    )

    if description is not None:
        # Mirror create_project_work_item: fill description_html too (#775).
        issue.description = description
        issue.description_html = description
    # Resolve the type BEFORE the state: the birth state depends on it, so an
    # Implementation lands at its workflow start instead of a generic default.
    issue.issue_type = resolve_issue_type(module.project_id, issue_type_id, "task")
    issue.state_id = resolve_birth_state(module.project_id, issue.issue_type, None)

    with transaction.atomic():
        issue.save()

    return issue


def update_work_item(issue_id: uuid.UUID, *, actor=None, **data):
    """Apply a work-item patch and persist lifecycle side effects.

    A workflow **state change is its own operation**: when ``state_id`` is
    present it routes through the sole-writer (:func:`transition_state`, #860),
    which validates the per-type transition before writing and archives the
    cancelled subtree in the same transaction. It may **not** be bundled with any
    other field edit — that would let a caller smuggle a gated move past inside a
    larger PATCH — so a mixed patch is rejected. ``origin`` identifies the
    transition caller and defaults to ``human`` for REST compatibility.
    ``force`` is a human-only modifier that bypasses the graph and is recorded.
    """

    issue = get_object_or_404(Issue, pk=issue_id)

    if "state_id" in data:
        force = bool(data.pop("force", False))
        force_if_completed = bool(data.pop("force_if_completed", False))
        origin = data.pop("origin", "human")
        if set(data) - {"state_id"}:
            raise ValidationError(
                "A state change must be its own PATCH — send state_id alone."
            )
        with transaction.atomic():
            if force_if_completed:
                target_group = (
                    State.objects.select_for_update()
                    .filter(pk=data["state_id"], project_id=issue.project_id)
                    .values_list("group", flat=True)
                    .first()
                )
                force = force or target_group == "completed"
            return transition_state(
                issue,
                data["state_id"],
                force=force,
                actor=actor,
                origin=origin,
            )

    # No state move: transition modifiers are meaningless for a plain field edit.
    data.pop("force", None)
    data.pop("force_if_completed", None)
    data.pop("origin", None)

    if "parent_id" in data:
        issue.parent_id = data["parent_id"]
    if "name" in data:
        issue.name = data["name"]
    if "description_html" in data:
        issue.description_html = data["description_html"]

    with transaction.atomic():
        issue.save()

        if "blocked_by_ids" in data:
            new_ids = [str(i) for i in (data["blocked_by_ids"] or [])]
            if str(issue.id) in new_ids:
                raise ValidationError("An issue cannot block itself.")
            if blocker_would_cycle(str(issue.id), new_ids):
                raise ValidationError("That blocker would create a cycle.")
            issue.blocked_by.set(new_ids)

        if "labels" in data:
            apply_label_names(issue, data["labels"])

    return issue


def reorder_work_item(issue_id: uuid.UUID, before_id=None, after_id=None):
    """Move an issue between same-project neighbors and persist the new rank."""

    issue = get_object_or_404(Issue, pk=issue_id)
    before = _reorder_neighbor(issue, before_id)
    after = _reorder_neighbor(issue, after_id)

    before_rank = (before.rank or None) if before else None
    after_rank = (after.rank or None) if after else None

    try:
        issue.rank = key_between(before_rank, after_rank)
    except ValueError as exc:
        raise ValidationError("before/after are not ordered neighbors.") from exc

    issue.save(update_fields=["rank", "updated_at"])
    return issue


def delete_work_item(issue_id: uuid.UUID):
    """Delete an empty issue and reject issues with children."""

    issue = get_object_or_404(Issue, pk=issue_id)
    if issue.children.exists():
        raise ConflictError("Issue has children; empty or re-parent them first.")
    issue.delete()


def _reorder_neighbor(issue, neighbor_id):
    if neighbor_id is None:
        return None
    neighbor = get_object_or_404(Issue, pk=neighbor_id)
    if neighbor.project_id != issue.project_id:
        raise ValidationError("Neighbor belongs to another project.")
    return neighbor
