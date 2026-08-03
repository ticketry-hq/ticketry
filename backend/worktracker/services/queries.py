"""Framework-neutral read/query services for the owned backend.

These are the read peers of the mutation services (``services/modules.py``,
``services/work_items.py``). They return plain, fully-materialized Python data
(``dict`` / ``list`` / ``tuple`` of primitives) shaped like the subset of the
``*Out`` Ninja schemas the in-process adapter actually reads — so the adapter's
``_to_task_summary`` / ``_to_state`` mappers consume them verbatim, with no
field gymnastics and no DTO drift.

The package stays framework-neutral: no Ninja ``Schema`` import, no ``core``
import. All ORM access (lazy relations, the ``child_count`` annotation) happens
inside these functions so it runs entirely within the caller's ``sync_to_async``
thread; the returned value touches no lazy relation.

The read query functions raise the ``services.errors`` family (the #735
contract), never Django ``Http404`` or httpx errors.
"""

import uuid

from django.http import Http404

from worktracker.models import Issue, State
from worktracker.services.errors import NotFoundError
from worktracker.work_items import resolve_issue, task_qs


def _state_dict(state):
    """Project a State (or ``None``) into the nested state dict the adapter reads.

    Returns ``None`` for an unset state so the adapter's ``"Unknown"`` fallback
    fires, matching the route's ``StateOut`` (a nested object or null).
    """

    if state is None:
        return None
    return {
        "id": state.id,
        "name": state.name,
        "group": state.group,
        "color": state.color,
    }


def _work_item_dict(issue):
    """Project a task ``Issue`` onto the work-item dict subset the adapter reads.

    Mirrors the fields ``WorkItemOut`` exposes that the adapter consumes:
    nested ``state`` (or ``None``), description,
    ``parent_id`` and ``sub_issues_count`` (from the ``task_qs``
    ``child_count`` annotation, falling back to a direct count exactly as
    ``WorkItemOut.resolve_sub_issues_count`` does).
    """

    annotated = getattr(issue, "child_count", None)
    sub_issues_count = annotated if annotated is not None else issue.children.count()

    return {
        "id": issue.id,
        "name": issue.name,
        "project_id": issue.project_id,
        "sequence_id": issue.sequence_id,
        "state": _state_dict(issue.state),
        "issue_type": (
            {"name": issue.issue_type.name} if issue.issue_type else None
        ),
        "description": issue.description,
        "parent_id": issue.parent_id,
        "sub_issues_count": sub_issues_count,
    }


def list_modules(project_id: uuid.UUID, include_archived: bool = False):
    """List a project's module issues (mirrors ``GET /projects/{id}/modules``).

    Archived modules are hidden unless ``include_archived`` — matching the
    route's default.
    """

    qs = Issue.objects.filter(project_id=project_id, type="module")
    if not include_archived:
        qs = qs.exclude(is_archived=True)
    return [
        {"id": m.id, "name": m.name, "project_id": m.project_id}
        for m in qs
    ]


def list_states(project_id: uuid.UUID):
    """List a project's states, ordered ``(sort_order, created_at)``.

    Mirrors ``GET /projects/{id}/states``.
    """

    states = State.objects.filter(project_id=project_id).order_by(
        "sort_order", "created_at"
    )
    return [_state_dict(s) for s in states]


def _module_subtree_qs(module_id: uuid.UUID, include_archived: bool):
    """Build the ordered task-descendant subtree queryset for a module.

    Reproduces ``api.work_items.list_module_work_items``: BFS-walk the parent
    tree from the module, then return the annotated ``task_qs`` rows ordered
    ``(rank, sequence_id)``. Archived tasks are excluded unless requested.
    """

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
    return qs.order_by("rank", "sequence_id")


def list_module_tasks_and_states(project_id: uuid.UUID, module_id: uuid.UUID):
    """Return ``(work-item dicts, state dicts)`` for a module in one hop.

    Collapses the two parallel reads the adapter made over HTTP into a single
    in-process call. Returns the **full** subtree (the direct-children filter is
    the adapter's responsibility, preserving ``get_tasks_and_states`` vs
    ``get_module_task_summaries`` semantics) plus the project's states.
    """

    items = [_work_item_dict(issue) for issue in _module_subtree_qs(module_id, False)]
    states = list_states(project_id)
    return items, states


def retrieve_work_item(issue_id: str):
    """Retrieve one task by UUID or ``KEY-N`` (mirrors ``GET /work-items/{id}``).

    Raises the framework-neutral ``NotFoundError`` (not Django ``Http404``) when
    the issue is absent, keeping the service boundary framework-neutral.
    """

    try:
        issue = resolve_issue(issue_id)
    except Http404 as exc:
        raise NotFoundError("Work item not found.") from exc
    return _work_item_dict(issue)
