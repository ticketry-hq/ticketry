"""Work item query and workflow helpers shared by route handlers.

The HTTP routes stay in the ``api`` package and the mutation policy in
``services``; this module owns the deeper work item query helpers so callers do
not need to know the issue tree, key resolution, rank allocation, blocker graph,
or scope-context mechanics.
"""

import re
import uuid

from django.db.models import Count, Max, Prefetch, Q
from django.shortcuts import get_object_or_404

from worktracker.models import Issue, IssueType, State
from worktracker.ranking import key_between
from worktracker.services.errors import NotFoundError, ValidationError
from worktracker.state_groups import RESOLVED_GROUPS


# A KEY-N segment is a single hyphen between a non-hyphen prefix and digits;
# a UUID has four hyphens, so this never matches one.
_KEY_RE = re.compile(r"^([^-]+)-(\d+)$")


def issue_qs():
    """Return the issue queryset annotated with each issue's child count."""

    return (
        Issue.objects.select_related("project", "state", "issue_type")
        .prefetch_related("blocked_by", "blocks")
        # Exclude archived children from the rollup (#633): a cancelled child
        # won't load, so an epic whose only remaining children are cancelled
        # must report no children.
        .annotate(
            child_count=Count("children", filter=Q(children__is_archived=False))
        )
    )


def task_qs():
    """Return the task queryset annotated with each issue's child count."""

    return issue_qs().filter(type="task")


def cascade_archive(root):
    """Archive every task descendant of a just-cancelled issue (#633)."""

    frontier = list(root.children.values_list("id", flat=True))
    seen = set()
    while frontier:
        child_id = frontier.pop()
        if child_id in seen:
            continue
        seen.add(child_id)
        frontier.extend(
            Issue.objects.filter(parent_id=child_id).values_list("id", flat=True)
        )
    if seen:
        Issue.objects.filter(id__in=seen).update(is_archived=True)


def default_state_id(project_id):
    """Return the project's Backlog-group state id, or ``None`` if absent."""

    state = (
        State.objects.filter(project_id=project_id, group="backlog")
        .order_by("sort_order", "created_at")
        .first()
    )
    return state.id if state else None


def append_rank(project_id):
    """Return a fractional key sorting after every existing rank in the project."""

    last_rank = (
        Issue.objects.filter(project_id=project_id)
        .exclude(rank="")
        .aggregate(m=Max("rank"))["m"]
    )
    return key_between(last_rank or None, None)


def resolve_issue_type(project_id, issue_type_id, bucket):
    """Resolve an explicitly selected IssueType for the requested level."""

    if issue_type_id is None:
        raise ValidationError("issue_type_id is required.")
    try:
        issue_type = IssueType.objects.get(pk=issue_type_id, project_id=project_id)
    except IssueType.DoesNotExist as exc:
        raise NotFoundError("Issue type not found.") from exc
    if issue_type.level != bucket:
        raise ValidationError(
            f"Issue type '{issue_type.name}' is level "
            f"'{issue_type.level}', not '{bucket}'."
        )
    return issue_type


def module_descendant_task_qs(module_id):
    """Return every task descendant of a module, as an unordered ``task_qs``.

    Membership rides the ``parent`` link, so this is a BFS over the parent tree
    rather than a flat filter: direct children plus their subtasks, to any
    depth. Callers apply their own archived/PathFind exclusions and ordering —
    those differ between the route and the in-process query.
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

    return task_qs().filter(id__in=descendant_ids)


def resolve_in(qs, id_or_key):
    """Resolve an issue within ``qs`` by UUID pk or by its ``KEY-N`` address.

    The one place the ``KEY-N`` form is parsed. Callers supply the queryset so
    each keeps its own filtering and prefetching, without re-implementing (and
    drifting on) the address grammar.
    """

    match = _KEY_RE.match(id_or_key)
    if match:
        slug, sequence_id = match.group(1), int(match.group(2))
        # Keys are shown uppercase but typed however — match slug case-blind.
        return get_object_or_404(
            qs, project__slug__iexact=slug, sequence_id=sequence_id
        )
    return get_object_or_404(qs, pk=id_or_key)


def resolve_issue(id_or_key, *, task_only=True):
    """Resolve an issue by UUID pk or by its ``KEY-N`` address."""

    return resolve_in(task_qs() if task_only else issue_qs(), id_or_key)


def blocker_would_cycle(issue_id, new_blocker_ids):
    """Return True if adding blockers would create a directed blocker cycle."""

    target = str(issue_id)
    visited = set()
    frontier = [str(i) for i in new_blocker_ids]

    while frontier:
        cur = frontier.pop()
        if cur == target:
            return True
        if cur in visited:
            continue
        visited.add(cur)
        blockers = Issue.objects.filter(blocks=cur).values_list("id", flat=True)
        frontier.extend(str(b) for b in blockers)

    return False


def scope_ref(issue):
    """Project one issue into the compact ScopeRef shape (#667)."""

    group = issue.state.group if issue.state else None
    return {
        "id": issue.id,
        "key": issue.key,
        "name": issue.name,
        "state_group": group,
        "resolved": group in RESOLVED_GROUPS,
    }


def build_scope_context(issue_id):
    """Build the read-only dependency slice a subagent consumes for a task."""

    neighbor_qs = Issue.objects.select_related("state", "project")
    base = (
        Issue.objects.filter(type="task")
        .select_related("project", "state")
        .prefetch_related(
            Prefetch("blocked_by", queryset=neighbor_qs),
            Prefetch("blocks", queryset=neighbor_qs),
        )
    )

    issue = resolve_in(base, issue_id)

    depends_on = [scope_ref(b) for b in issue.blocked_by.all()]
    depended_by = [scope_ref(b) for b in issue.blocks.all()]

    unresolved = [ref for ref in depends_on if not ref["resolved"]]
    if unresolved:
        keys = ", ".join(ref["key"] for ref in unresolved)
        advisory = (
            f"{len(unresolved)} of {len(depends_on)} blocker(s) unresolved "
            f"({keys}) - stay within this task; do not implement upstream work."
        )
    else:
        advisory = (
            "No unresolved blockers - deliver only this task and nothing beyond "
            "its scope."
        )

    return {
        "task": scope_ref(issue),
        "depends_on": depends_on,
        "depended_by": depended_by,
        "advisory": advisory,
    }
