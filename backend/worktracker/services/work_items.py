"""Framework-neutral work item mutation services."""

import re
import uuid

from django.db import transaction

from worktracker.models import Issue, IssueType, Project
from worktracker.ranking import key_between
from worktracker.sequences import allocate_sequence_id
from worktracker.services.errors import ConflictError, NotFoundError, ValidationError
from worktracker.services.module_reorder import reorder_module
from worktracker.work_items import (
    append_rank,
    blocker_would_cycle,
    resolve_issue_type,
    task_qs,
)
from worktracker.workflow import (
    InvalidTransition,
    resolve_birth_state,
    transition_state,
)


def resolve_module_id(parent: Issue | None) -> uuid.UUID | None:
    """Return the denormalized module ancestor carried by ``parent``."""

    if parent is None:
        return None
    if parent.type == "module":
        return parent.id
    return parent.module_id


def get_issue(issue_id, *, message="Work item not found."):
    """Fetch an issue or raise the framework-neutral not-found error.

    Services own a single not-found mechanism: ``NotFoundError`` carries the
    domain message to ``api/router.py:_http_errors()``, the one translation
    seam. Django's fetch-or-404 shortcut would bypass it — Ninja's own handler
    emits a generic body, losing the message, and non-HTTP callers (the MCP
    surface) would receive a Django HTTP exception where the contract promises
    a ``ServiceError``. ``test_t735_error_contract`` fences this.
    """

    try:
        return Issue.objects.get(pk=issue_id)
    except Issue.DoesNotExist as exc:
        raise NotFoundError(message) from exc


def retrieve_work_item(issue_id):
    """Return one task by UUID or key through the framework-neutral boundary."""

    value = str(issue_id)
    key_match = re.fullmatch(r"([^-]+)-(\d+)", value)
    try:
        if key_match:
            slug, sequence_id = key_match.groups()
            return task_qs().get(
                project__slug__iexact=slug,
                sequence_id=int(sequence_id),
            )
        return task_qs().get(pk=uuid.UUID(value))
    except (Issue.DoesNotExist, ValueError) as exc:
        raise NotFoundError("Work item not found.") from exc


def list_work_items(
    *,
    project_id=None,
    module_id=None,
    state_id=None,
    include_archived=False,
):
    """Return the canonical filtered task collection in stable rank order."""

    queryset = task_qs().order_by("rank", "sequence_id", "id")
    if project_id is not None:
        queryset = queryset.filter(project_id=project_id)
    if module_id is not None:
        queryset = queryset.filter(module_id=module_id)
    if state_id is not None:
        queryset = queryset.filter(state_id=state_id)
    if not include_archived:
        queryset = queryset.exclude(is_archived=True)
    return queryset


def batch_work_items(ids):
    """Return existing tasks in the caller's de-duplicated id order."""

    ordered_ids = tuple(dict.fromkeys(ids))
    items_by_id = {item.id: item for item in task_qs().filter(id__in=ordered_ids)}
    return [items_by_id[item_id] for item_id in ordered_ids if item_id in items_by_id]


def create_work_item(project_id, **data):
    """Choose the canonical ordinary-task or review-finding create workflow."""

    if not data.get("issue_type_id"):
        return create_review_finding(
            project_id,
            parent_id=data["parent_id"],
            name=data["name"],
            description=data.get("description") or "",
        )
    return create_project_work_item(
        project_id,
        name=data["name"],
        issue_type_id=data["issue_type_id"],
        state_id=data.get("state_id"),
        description=data.get("description"),
        parent_id=data.get("parent_id"),
    )


def create_project_work_item(
    project_id: uuid.UUID,
    *,
    name: str,
    issue_type_id,
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
    issue = Issue(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name=name,
        sequence_id=allocate_sequence_id(project.id),
        rank=append_rank(project.id),
    )

    if description is not None:
        issue.description = description
    if parent_id:
        parent = get_issue(parent_id, message="Parent work item not found.")
        issue.parent = parent
        issue.module_id = resolve_module_id(parent)
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
):
    """Create an Implementation finding under a Story in Review (#905).

    The dedicated, validated create the Story integration-review agent uses to
    turn a finding into a fresh Implementation child: the child is born in the
    Implementation workflow's start stage, typed ``Implementation``, and
    parented to a Story that is currently in ``Review``.

    Every parent / type / state / project precondition is checked **before any
    write**; a rejection raises :class:`~worktracker.workflow.InvalidTransition`
    so the caller receives the same machine-readable 422 body
    (``detail``/``code``/``from``/``to``) the workflow status gate emits.

    Inert by contract: no agent launch, no parent state move, no scheduler, and
    no blocker/dependency edge — just the parented child. The actual write reuses
    :func:`create_project_work_item`, so description handling, rank, and
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

    parent_type = parent.issue_type.name
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
    issue_type_id,
    description=None,
):
    """Create a task under a module and return the saved issue."""

    module = get_issue(module_id, message="Module not found.")
    sequence_id = allocate_sequence_id(module.project_id)

    issue = Issue(
        id=uuid.uuid4(),
        project_id=module.project_id,
        type="task",
        name=name,
        sequence_id=sequence_id,
        parent=module,
        module=module,
        rank=append_rank(module.project_id),
    )

    if description is not None:
        issue.description = description
    # Resolve the type BEFORE the state: the birth state depends on it, so an
    # Implementation lands at its workflow start instead of a generic default.
    issue.issue_type = resolve_issue_type(module.project_id, issue_type_id, "task")
    issue.state_id = resolve_birth_state(module.project_id, issue.issue_type, None)

    with transaction.atomic():
        issue.save()

    return issue


def update_work_item(issue_id: uuid.UUID, **data):
    """Apply a work-item patch and persist workflow side effects.

    A workflow **state change is its own operation**: when ``state_id`` is
    present it routes through the sole-writer (:func:`transition_state`, #860),
    which validates the per-type transition before writing and archives the
    cancelled subtree in the same transaction. It may **not** be bundled with any
    other field edit — that would let a caller smuggle a gated move past inside a
    larger PATCH — so a mixed patch is rejected. ``origin`` identifies the
    transition caller and defaults to ``human`` for REST compatibility.
    """

    issue = get_issue(issue_id)

    if "state_id" in data:
        origin = data.pop("origin", "human")
        if set(data) - {"state_id"}:
            raise ValidationError(
                "A state change must be its own PATCH — send state_id alone."
            )
        with transaction.atomic():
            return transition_state(
                issue,
                data["state_id"],
                origin=origin,
            )

    # No state move: origin is meaningless for a plain field edit.
    data.pop("origin", None)

    parent_changed = "parent_id" in data
    if parent_changed:
        parent_id = data["parent_id"]
        parent = (
            get_issue(parent_id, message="Parent work item not found.")
            if parent_id
            else None
        )
        issue.parent = parent
        issue.module_id = resolve_module_id(parent)
    if "name" in data:
        issue.name = data["name"]
    if "description" in data:
        issue.description = data["description"]
    if "issue_type_id" in data:
        issue.issue_type = resolve_issue_type(
            issue.project_id,
            data["issue_type_id"],
            issue.type,
        )

    with transaction.atomic():
        issue.save(force_change_revision="blocked_by_ids" in data)

        if parent_changed:
            descendants = []
            frontier = [issue]
            while frontier:
                module_ids_by_parent = {
                    parent.id: resolve_module_id(parent) for parent in frontier
                }
                children = list(
                    Issue.objects.filter(parent_id__in=module_ids_by_parent)
                )
                for child in children:
                    child.module_id = module_ids_by_parent[child.parent_id]
                descendants.extend(children)
                frontier = children
            Issue.objects.bulk_update(descendants, ["module"], batch_size=500)

        if "blocked_by_ids" in data:
            new_ids = [str(i) for i in (data["blocked_by_ids"] or [])]
            if str(issue.id) in new_ids:
                raise ValidationError("An issue cannot block itself.")
            if blocker_would_cycle(str(issue.id), new_ids):
                raise ValidationError("That blocker would create a cycle.")
            issue.blocked_by.set(new_ids)

    return issue


def reorder_work_item(
    issue_id: uuid.UUID, before_id=None, after_id=None, initial_order_ids=None
):
    """Move an issue between same-project neighbors and persist the new rank.

    Module work items carry a second order — the project's Manual module order
    — whose first drag has to freeze a baseline and flip the project's ordering
    mode atomically. That belongs to ``module_reorder``; the task path below is
    the plain fractional-rank move it has always been (#360).
    """

    issue = get_issue(issue_id)
    if issue.type == "module":
        return reorder_module(issue, before_id, after_id, initial_order_ids)
    if initial_order_ids:
        raise ValidationError(
            "initial_order_ids applies only to module work items."
        )

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

    issue = get_issue(issue_id)
    if issue.children.exists():
        raise ConflictError("Issue has children; empty or re-parent them first.")
    issue.delete()


def _reorder_neighbor(issue, neighbor_id):
    if neighbor_id is None:
        return None
    neighbor = get_issue(neighbor_id, message="Neighbor not found.")
    if neighbor.project_id != issue.project_id:
        raise ValidationError("Neighbor belongs to another project.")
    if neighbor.type == "module":
        raise ValidationError("A task may not be ranked against a module.")
    return neighbor
