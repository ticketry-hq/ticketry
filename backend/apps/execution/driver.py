from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from threading import Lock
from weakref import WeakValueDictionary

from asgiref.sync import async_to_sync
from django.db import IntegrityError

from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue, LaunchBinding
from worktracker.state import state_group

from apps.execution.models import GraphRun, LaunchedTask
from apps.terminals.session import LaunchIntent, session as terminal_session
from apps.terminals.launch_configuration import (
    ResolvedLaunchConfiguration,
    resolve_task_launch_configuration,
)

logger = logging.getLogger(__name__)

SpawnRun = Callable[..., Awaitable[str]]
REVIEW_STATE_NAME = "Review"

# The desktop application owns one supervised backend process. Serialize
# execute/revive requests per root in that process so the liveness check,
# inactive-ledger reset, and replacement launches form one operation without
# holding a database transaction open while the terminal worker writes through
# its own connection.
_GRAPH_EXECUTION_LOCKS: WeakValueDictionary[str, Lock] = WeakValueDictionary()
_GRAPH_EXECUTION_LOCKS_GUARD = Lock()


async def spawn_run(**kwargs) -> str:
    return await terminal_session.spawn(LaunchIntent(**kwargs))


@dataclass(frozen=True)
class LaunchResult:
    """One direct task-session launch's durable facts (CODIN-924)."""

    target_id: str
    agent: str
    agent_run_id: str


@dataclass(frozen=True)
class DependencyGraphNode:
    id: str
    state: str
    parent_id: str | None
    blocked_by: tuple[str, ...]


@dataclass(frozen=True)
class DependencyGraphState:
    root_id: str
    nodes: tuple[DependencyGraphNode, ...]


def launch_task_agent(
    task_id: str,
    *,
    agent: str | None,
    launch_configuration: ResolvedLaunchConfiguration | None = None,
    spawn: SpawnRun | None = None,
) -> LaunchResult:
    """Launch one direct coding session for a target work item (CODIN-924).

    Resolves the target task and its module ancestry, then invokes the terminal
    seam with ``scope="task"`` and *no* caller prompt — so the canonical task
    prompt (ticket context + SDLC), design-dir calculation, live-worktree
    selection, AgentRun/terminal persistence, and MCP injection all run
    exactly as the normal task launch. Deliberately outside subtree execution:
    it seeds no ``GraphRun``/``LaunchedTask`` state and moves no workflow state —
    a launch is just a launch. A caller may supply an immutable configuration it
    already resolved for a committed destination event; otherwise current-state
    policy is resolved here. Repeated calls each start a fresh detached run,
    matching current direct terminal behavior.

    :raises ValueError: ``task_not_found`` (unknown/non-task target) or
        ``module_id_required`` (no module ancestor).
    :raises NoConfigurationSelected / LaunchUnavailable: from the terminal seam,
        preserved verbatim so the caller maps the terminal-launch prerequisites.
    """

    issue = (
        Issue.objects.select_related("project").filter(pk=task_id, type="task").first()
    )
    if issue is None:
        raise ValueError("task_not_found")
    module_id = _module_id_for(issue)
    if module_id is None:
        raise ValueError("module_id_required")

    if launch_configuration is not None:
        agent = launch_configuration.agent
    elif agent is None:
        launch_configuration = resolve_task_launch_configuration(str(issue.id))
        agent = launch_configuration.agent

    launch_kwargs = {
        "agent": agent,
        "project_id": str(issue.project_id),
        "module_id": module_id,
        "task_id": str(issue.id),
        "scope": "task",
    }
    if launch_configuration is not None:
        launch_kwargs["launch_configuration"] = launch_configuration
    run_id = async_to_sync(spawn or spawn_run)(
        **launch_kwargs,
    )
    assert agent is not None
    return LaunchResult(target_id=str(issue.id), agent=agent, agent_run_id=run_id)


def get_dependency_graph(root_id: str) -> DependencyGraphState:
    """Read the factual workflow state and edges for a task subtree."""

    root = (
        Issue.objects.filter(pk=root_id, type="task", is_archived=False)
        .select_related("state")
        .prefetch_related("blocked_by")
        .first()
    )
    if root is None:
        raise ValueError("task_not_found")

    issues = [root, *_task_descendants(root)]
    edges = _dependency_edges(issues, root=root)
    blocked_by = {str(issue.id): [] for issue in issues}
    for blocker_id, blocked_id in sorted(edges):
        blocked_by[blocked_id].append(blocker_id)

    return DependencyGraphState(
        root_id=str(root.id),
        nodes=tuple(
            DependencyGraphNode(
                id=str(issue.id),
                state=issue.state.name,
                parent_id=str(issue.parent_id) if issue.parent_id else None,
                blocked_by=tuple(blocked_by[str(issue.id)]),
            )
            for issue in issues
        ),
    )


def satisfied(issue: Issue) -> bool:
    group = state_group(issue.state_id)
    # The hardcoded Review name is a candidate for workflow configuration later.
    return (
        group == "completed"
        or (issue.state is not None and issue.state.name == REVIEW_STATE_NAME)
        or group == "cancelled"
        or issue.is_archived
    )


def execute_graph(
    root_task_id: str,
    *,
    agent: str | None,
    spawn: SpawnRun | None = None,
) -> list[str]:
    """Arm or manually revive a root and launch eligible direct children.

    A repeat request keeps the duplicate-live-run guard: if any launch recorded
    for this root is still active, the existing campaign wins and the caller
    receives ``graph_run_exists``.  Once every recorded run and terminal has
    ended, however, the request is an explicit user-driven revival.  Its stale
    launch facts are cleared and the current graph is advanced again.
    """

    root = (
        Issue.objects.select_related("project", "issue_type", "state")
        .filter(pk=root_task_id, type="task")
        .first()
    )
    if root is None:
        raise ValueError("task_not_found")
    if not LaunchBinding.objects.filter(
        issue_type_id=root.issue_type_id,
        state_id=root.state_id,
        subtree_run_enabled=True,
    ).exists():
        raise ValueError("subtree_run_not_enabled")
    module_id = _module_id_for(root)
    if module_id is None:
        raise ValueError("module_id_required")
    if not Issue.objects.filter(
        parent_id=root.id,
        type="task",
        is_archived=False,
    ).exists():
        raise ValueError("graph_empty")

    try:
        with _graph_execution_lock(str(root.id)):
            header = GraphRun.objects.filter(pk=root.id).first()
            if header is None:
                GraphRun.objects.create(
                    root_id=root.id,
                    project_id=root.project_id,
                    module_id=module_id,
                    agent=agent,
                )
            else:
                if _has_active_subtree_launch(str(root.id)):
                    raise ValueError("graph_run_exists")
                # This POST is the manual recovery boundary. Completed children
                # remain satisfied by workflow state; unfinished children whose
                # prior run ended become launchable again.
                LaunchedTask.objects.filter(root_id=root.id).delete()
                header.project_id = root.project_id
                header.module_id = module_id
                header.agent = agent
                header.save(
                    update_fields=["project", "module", "agent", "updated_at"]
                )

            return advance(str(root.id), spawn=spawn)
    except IntegrityError as exc:
        # Preserve the resource-level conflict when concurrent creates race.
        raise ValueError("graph_run_exists") from exc


def _graph_execution_lock(root_id: str) -> Lock:
    with _GRAPH_EXECUTION_LOCKS_GUARD:
        return _GRAPH_EXECUTION_LOCKS.setdefault(root_id, Lock())


def _has_active_subtree_launch(root_id: str) -> bool:
    """Return whether a recorded launch still has a live run or terminal."""

    run_ids = list(
        LaunchedTask.objects.filter(root_id=root_id).values_list(
            "agent_run_id", flat=True
        )
    )
    if not run_ids:
        return False
    return (
        AgentRun.objects.filter(id__in=run_ids, ended_at__isnull=True).exists()
        or AgentTerminalSession.objects.filter(
            agent_run_id__in=run_ids,
            terminated_at__isnull=True,
        ).exists()
    )


def advance(root_id: str, *, spawn: SpawnRun | None = None) -> list[str]:
    """Launch every eligible direct child of an armed root. Returns launched task ids."""

    header = GraphRun.objects.filter(pk=root_id).first()
    if header is None:
        return []

    children = list(
        Issue.objects.filter(
            parent_id=root_id,
            type="task",
            is_archived=False,
        )
        .select_related("state")
        .prefetch_related("blocked_by__state")
        .order_by("sequence_id", "id")
    )
    launched_set = set(
        LaunchedTask.objects.filter(root_id=root_id).values_list("task_id", flat=True)
    )
    launched: list[str] = []
    spawn_call = spawn or spawn_run

    for child in children:
        if satisfied(child):
            continue
        if child.id in launched_set:
            continue
        if any(not satisfied(blocker) for blocker in child.blocked_by.all()):
            continue
        try:
            run_id = async_to_sync(spawn_call)(
                agent=header.agent,
                project_id=str(header.project_id),
                module_id=str(header.module_id),
                task_id=str(child.id),
                scope="task",
            )
        except Exception:
            logger.exception("execution subtree launch failed task=%s", child.id)
            continue

        LaunchedTask.objects.create(
            task=child,
            root_id=root_id,
            agent_run_id=run_id,
        )
        launched_set.add(child.id)
        launched.append(str(child.id))

    return launched


def reset_subtree(root_id: str) -> list[str]:
    """Delete a root's run header and launch ledger so it can be re-armed."""

    header = GraphRun.objects.filter(pk=root_id).first()
    if header is None:
        raise ValueError("graph_not_found")
    rows = LaunchedTask.objects.filter(root_id=root_id).order_by(
        "task__sequence_id", "task_id"
    )
    cleared = [str(task_id) for task_id in rows.values_list("task_id", flat=True)]
    rows.delete()
    header.delete()
    return cleared


def observe_issue_state_changed(
    *,
    issue_id: str,
    spawn: SpawnRun | None = None,
) -> list[str]:
    """Advance armed roots associated with the changed issue."""

    issue = Issue.objects.filter(pk=issue_id).only("id", "parent_id").first()
    candidate_ids = [str(issue_id)]
    if issue is not None and issue.parent_id is not None:
        candidate_ids.append(str(issue.parent_id))
    armed = {
        str(root_id)
        for root_id in GraphRun.objects.filter(root_id__in=candidate_ids).values_list(
            "root_id", flat=True
        )
    }

    launched: list[str] = []
    for root_id in candidate_ids:
        if root_id in armed:
            launched.extend(advance(root_id, spawn=spawn))
    return launched


def _dependency_edges(
    issues: list[Issue], *, root: Issue
) -> frozenset[tuple[str, str]]:
    """Gather live ``blocked_by`` edges whose endpoints are in ``issues``."""

    node_ids = {str(issue.id) for issue in issues}
    edges: set[tuple[str, str]] = set()
    for issue in issues:
        for blocker_id in issue.blocked_by.values_list("id", flat=True):
            blocker = str(blocker_id)
            blocked = str(issue.id)
            if blocker in node_ids:
                edges.add((blocker, blocked))
            else:
                logger.info(
                    "execution graph ignoring external blocker root=%s task=%s blocker=%s",
                    root.id,
                    issue.id,
                    blocker,
                )
    return frozenset(edges)


def _task_descendants(root: Issue) -> list[Issue]:
    descendants: list[Issue] = []
    frontier = [root.id]
    while frontier:
        children = list(
            Issue.objects.filter(
                parent_id__in=frontier,
                type="task",
                is_archived=False,
            )
            .select_related("state")
            .prefetch_related("blocked_by")
            .order_by("sequence_id", "id")
        )
        descendants.extend(children)
        frontier = [child.id for child in children]
    return descendants


def _module_id_for(issue: Issue) -> str | None:
    parent_id = issue.parent_id
    seen: set[str] = set()
    while parent_id is not None:
        current_id = str(parent_id)
        if current_id in seen:
            return None
        seen.add(current_id)
        parent = Issue.objects.filter(pk=parent_id).only("id", "type", "parent").first()
        if parent is None:
            return None
        if parent.type == "module":
            return str(parent.id)
        parent_id = parent.parent_id
    return None
