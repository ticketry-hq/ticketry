import uuid
from typing import List, Optional

from django.http import JsonResponse
from ninja import Status

from worktracker.api.router import _http_errors, router
from worktracker.models import Issue
from worktracker.lifecycle import set_lifecycle
from worktracker.workflow import InvalidTransition
from worktracker.schemas import (
    LifecycleIn,
    ModuleWorkItemIn,
    ReviewFindingIn,
    ScopeContextOut,
    WorkItemDetailOut,
    WorkItemIn,
    WorkItemOut,
    WorkItemPatch,
    WorkItemReorderIn,
)
from worktracker.services.work_items import (
    create_module_work_item as create_module_work_item_service,
    create_project_work_item,
    create_review_finding as create_review_finding_service,
    delete_work_item as delete_work_item_service,
    reorder_work_item as reorder_work_item_service,
    update_work_item,
)
from worktracker.work_items import (
    build_scope_context,
    resolve_issue,
    state_group_for_state_id,
    task_qs,
)


def _retired_priority_query_error(request):
    """Reject the exact retired query key without changing other extras."""

    if "priority" not in request.GET:
        return None
    return JsonResponse(
        {
            "detail": [
                {
                    "type": "removed_field",
                    "loc": ["query", "priority"],
                    "msg": "Work-item priority has been removed.",
                    "ctx": {"field": "priority", "location": "query"},
                }
            ]
        },
        status=422,
    )


@router.get(
    "/projects/{project_id}/work-items",
    response=List[WorkItemOut],
    operation_id="listProjectWorkItems",
    tags=["WorkItems"],
)
def list_work_items(
    request,
    project_id: uuid.UUID,
    parent: Optional[uuid.UUID] = None,
    state: Optional[uuid.UUID] = None,
    include_archived: bool = False,
    include_pathfind: bool = False,
):
    """List the project's tasks, optionally filtered by parent / state.

    No ``parent`` returns every task in the project. ``parent`` filters to the
    direct children of any issue (a module or a task) — membership is the same
    ``parent`` link regardless of the parent's type. Archived tasks are hidden
    unless ``include_archived=true``. PathFind tasks are hidden unless
    ``include_pathfind=true``.
    """
    retired_error = _retired_priority_query_error(request)
    if retired_error is not None:
        return retired_error

    qs = task_qs().filter(project_id=project_id)

    if parent is not None:
        qs = qs.filter(parent_id=parent)
    if state is not None:
        qs = qs.filter(state_id=state)
    if not include_archived:
        qs = qs.exclude(is_archived=True)
    if not include_pathfind:
        qs = qs.exclude(issue_type__name="PathFind")

    return qs.order_by("rank", "sequence_id")


@router.post(
    "/projects/{project_id}/work-items",
    response=WorkItemOut,
    operation_id="createProjectWorkItem",
    tags=["WorkItems"],
)
def create_work_item(request, project_id: uuid.UUID, payload: WorkItemIn):
    """Create a task issue; ``parent_id`` makes it a top-level task or subtask."""
    with _http_errors():
        issue = create_project_work_item(
            project_id,
            name=payload.name,
            issue_type_id=payload.issue_type_id,
            state_id=payload.state_id,
            description=payload.description,
            parent_id=payload.parent_id,
        )

    return issue


@router.post(
    "/projects/{project_id}/review-findings",
    response=WorkItemOut,
    operation_id="createReviewFinding",
    tags=["WorkItems"],
)
def create_review_finding(request, project_id: uuid.UUID, payload: ReviewFindingIn):
    """Create a Ready Implementation finding under a Story in Review (#905).

    The dedicated validated finding surface: the child is born in ``Ready`` and
    typed ``Implementation`` server-side. A parent that is not a Story, not in
    ``Review``, in a foreign project, or a non-Implementation type override is
    rejected *before any write* with the workflow gate's structured 422 body
    (``detail``/``code``/``from``/``to``) — identical to the status gate. This
    surface never launches an agent, moves the parent, or draws a dependency
    edge.
    """
    with _http_errors():
        try:
            issue = create_review_finding_service(
                project_id,
                parent_id=payload.parent_id,
                name=payload.name,
                description=payload.description,
                issue_type_id=payload.issue_type_id,
            )
        except InvalidTransition as exc:
            return JsonResponse(exc.as_body(), status=422)

    return issue


@router.get(
    "/modules/{module_id}/work-items",
    response=List[WorkItemOut],
    operation_id="listModuleWorkItems",
    tags=["WorkItems"],
)
def list_module_work_items(
    request,
    module_id: uuid.UUID,
    include_archived: bool = False,
    include_pathfind: bool = False,
):
    """Return the module's task-descendant subtree.

    Membership rides the ``parent`` link, so this is not a flat filter: it
    walks every task descendant of the module (direct children + subtasks).
    Each issue carries ``parent_id`` so the repo splits direct children from
    subtasks (#516 roll-ups). Archived tasks are hidden unless
    ``include_archived=true``. PathFind tasks are hidden unless
    ``include_pathfind=true``.
    """
    retired_error = _retired_priority_query_error(request)
    if retired_error is not None:
        return retired_error

    descendant_ids = []
    frontier = [module_id]

    while frontier:
        children = list(
            Issue.objects.filter(parent_id__in=frontier, type="task").values_list(
                "id", flat=True
            )
        )
        descendant_ids.extend(children)
        frontier = children

    qs = task_qs().filter(id__in=descendant_ids)

    if not include_archived:
        qs = qs.exclude(is_archived=True)
    if not include_pathfind:
        qs = qs.exclude(issue_type__name="PathFind")

    return qs.order_by("rank", "sequence_id")


@router.post(
    "/modules/{module_id}/work-items",
    response=WorkItemOut,
    operation_id="createModuleWorkItem",
    tags=["WorkItems"],
)
def create_module_work_item(
    request, module_id: uuid.UUID, payload: ModuleWorkItemIn
):
    """Create a task parented to the module (resolving its project)."""
    with _http_errors():
        return create_module_work_item_service(
            module_id,
            name=payload.name,
            issue_type_id=payload.issue_type_id,
            description=payload.description,
        )


@router.get(
    "/work-items/{issue_id}",
    response=WorkItemDetailOut,
    operation_id="getWorkItem",
    tags=["WorkItems"],
)
def retrieve_work_item(request, issue_id: str):
    """Retrieve one task by UUID or ``KEY-N``, with state + attachments."""

    issue = resolve_issue(issue_id)

    return {"task": issue, "attachments": list(issue.attachments.all())}


@router.get(
    "/work-items/{issue_id}/scope-context",
    response=ScopeContextOut,
    operation_id="getWorkItemScopeContext",
    tags=["WorkItems"],
)
def work_item_scope_context(request, issue_id: str):
    """Read-only dependency slice a subagent consumes for a task (#667, B).

    Resolve the task by UUID or ``KEY-N`` (404 otherwise), then walk its
    **direct** edges: ``blocked_by`` becomes ``depends_on`` (must land first),
    ``blocks`` becomes ``depended_by`` (waits on this). Any neighbor carrying a
    non-empty ``assignees`` set is also flagged ``owned_elsewhere``, and a short
    ``advisory`` summarizes the unresolved-blocker situation. Derived entirely
    from existing edges + the ``assignees`` M2M — no writes, no new field.

    ``prefetch_related`` (with ``select_related`` folded into each neighbor
    queryset) bounds this to a handful of queries regardless of edge count.
    Transitive upstream is a noted later toggle; v1 is the direct edge sets.
    """

    return build_scope_context(issue_id)


@router.patch(
    "/work-items/{issue_id}",
    response=WorkItemOut,
    operation_id="updateWorkItem",
    tags=["WorkItems"],
)
def patch_work_item(request, issue_id: str, payload: WorkItemPatch):
    """Apply only the present patch fields; ``parent_id`` reparents the issue.

    A ``state_id`` move routes through the workflow gate (#860) and must be its
    own PATCH — a rejected move returns a structured 422 (``detail``/``code``/
    ``from``/``to``). ``origin`` defaults to ``human``; agent-origin writes are
    checked against edge permissions and cannot use ``force``.
    """

    data = payload.dict(exclude_unset=True)
    with _http_errors():
        try:
            issue = update_work_item(issue_id, **data)
        except InvalidTransition as exc:
            # The gate's structured 422 — a machine ``code`` and the offending
            # ``from → to`` alongside the human ``detail``. Returning here exits
            # ``_http_errors`` normally, so other ServiceErrors (404, bundled-edit
            # 422) keep their existing ``{"detail"}`` mapping.
            return JsonResponse(exc.as_body(), status=422)

    return resolve_issue(str(issue.id))


@router.post(
    "/work-items/{issue_id}/reorder",
    response=WorkItemOut,
    operation_id="reorderWorkItem",
    tags=["WorkItems"],
)
def reorder_work_item(request, issue_id: uuid.UUID, payload: WorkItemReorderIn):
    """Set the moved issue's rank strictly between its destination neighbors (#626).

    ``before_id`` / ``after_id`` are the issue's new column neighbors (the rows
    it lands below / above); either is null for the top, the bottom, or an empty
    column. Only the moved row is written — the neighbors are untouched, so two
    users reordering the same column never corrupt each other's keys. A
    cross-column move PATCHes ``state_id`` first, then calls this
    with the destination neighbors. Reorder is the sole rank write path, so the
    fractional-key algebra (and its strict ordering) can't be bypassed.
    """

    with _http_errors():
        issue = reorder_work_item_service(
            issue_id, payload.before_id, payload.after_id
        )

    return resolve_issue(str(issue.id))


@router.delete(
    "/work-items/{issue_id}",
    response={204: None},
    operation_id="deleteWorkItem",
    tags=["WorkItems"],
)
def delete_work_item(request, issue_id: uuid.UUID):
    """Delete an empty issue by UUID; 409 if it still has children.

    Blocking non-empty deletes (rather than orphaning) means no accidental
    subtree loss — the caller re-parents or deletes the children first.
    """

    with _http_errors():
        delete_work_item_service(issue_id)

    return Status(204, None)


@router.post(
    "/work-items/{issue_id}/lifecycle",
    response=WorkItemOut,
    operation_id="setWorkItemLifecycle",
    tags=["WorkItems"],
)
def set_work_item_lifecycle(request, issue_id: str, payload: LifecycleIn):
    """Advance the issue's internal lifecycle to ``target`` (#758), guarded.

    The single write path for ``Issue.lifecycle_state``: ``set_lifecycle``
    validates the transition and the ``(lifecycle_state, state)`` pairing,
    raising ``InvalidTransition`` (a ``ValidationError`` → 422) on any illegal
    move. Resolves modules too (``task_only=False``); a missing id/key
    404s. Returns the hydrated item carrying the new state + fresh transitions.
    """

    with _http_errors():
        issue = resolve_issue(issue_id, task_only=False)
        set_lifecycle(issue, payload.target)

    return resolve_issue(str(issue.id), task_only=False)
