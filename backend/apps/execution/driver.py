from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace

from asgiref.sync import async_to_sync

from worktracker.lifecycle import InvalidTransition, set_lifecycle
from worktracker.models import Issue, LaunchBinding
from worktracker.state_groups import state_group

from apps.execution.graph import GraphState, TaskNode, decide_graph
from apps.execution.models import EngineRun, GraphRun
from apps.execution.reducer import decide
from apps.execution.state import EngineState, LaunchAction, Phase, SeamEvent
from apps.runs.models import AgentRun
from apps.terminals.session import LaunchIntent, session as terminal_session
from apps.terminals.launch_configuration import (
    ResolvedLaunchConfiguration,
    resolve_task_launch_configuration,
)

logger = logging.getLogger(__name__)

SpawnRun = Callable[..., Awaitable[str]]
LiveRunFor = Callable[[str], AgentRun | None]
LAUNCH_LIFECYCLE: dict[Phase, str | None] = {
    "refine": "refining",
    "split": "generating_hld",
    "register": "registering_split",
    "lld": "lld_generating",
    "implement": None,
}
REVIEW_STATE_NAME = "Review"

_registry: dict[str, EngineState] = {}
_graph_registry: dict[str, GraphState] = {}


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
    selection, AgentRun/terminal persistence, and lifecycle/MCP injection all run
    exactly as the normal task launch. Deliberately outside the reducer: it seeds
    no ``EngineRun``/``GraphRun`` state and moves no workflow/lifecycle state — a
    launch is just a launch. A caller may supply an immutable configuration it
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


def clear_registry() -> None:
    _registry.clear()
    _graph_registry.clear()
    GraphRun.objects.all().delete()
    EngineRun.objects.all().delete()


def get_state(task_id: str) -> EngineState | None:
    try:
        run = EngineRun.objects.get(pk=task_id)
        return EngineState(
            task_id=str(run.task_id),
            project_id=str(run.project_id),
            module_id=str(run.module_id) if run.module_id else None,
            agent=run.agent,
            phase=run.phase,
            status=run.status,
            agent_run_id=run.agent_run_id,
            error=run.error,
        )
    except EngineRun.DoesNotExist:
        return None


def get_graph(root_id: str) -> GraphState | None:
    """Rebuild the graph state for ``root_id`` from durable facts.

    Source of truth is the ``GraphRun`` header (CODIN-777) plus the S1
    ``EngineRun`` node rows and the live ``blocked_by`` edges — never the
    in-memory cache. Rebuilding on every read is what makes a ``blocked_by``
    change show up in the returned edges/ready-status, and what lets the graph
    survive an ASGI restart. ``None`` (→ HTTP 404) now means *no header row
    exists*, not *the process restarted*.
    """

    context = _load_graph_context(root_id)
    if context is None:
        return None
    header, root, module_id = context
    return _store_graph(
        _build_graph_state(
            root,
            module_id,
            header.agent,
            live_run_for=terminal_session.live_run_for,
        )
    )


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


def reset_graph(root_id: str) -> GraphState:
    """Clear failed/halted graph facts and rebuild without launching work."""

    context = _load_graph_context(root_id)
    if context is None:
        raise ValueError("graph_not_found")
    header, root, module_id = context

    # Replace, rather than fold into, the cached graph so a later seam event
    # cannot persist a stale failed/halted node back into durable storage.
    _graph_registry.pop(str(root_id), None)
    descendants = _task_descendants(root)
    reset_facts = EngineRun.objects.filter(
        task_id__in=[issue.id for issue in descendants],
        phase="implement",
        status__in=("failed", "halted"),
    )
    reset_task_ids = set(reset_facts.values_list("task_id", flat=True))
    reset_facts.delete()
    for issue in descendants:
        if issue.id in reset_task_ids and issue.lifecycle_state == "failed":
            _try_advance_lifecycle(issue, "lld_approved")
    graph = _build_graph_state(
        root,
        module_id,
        header.agent,
        live_run_for=terminal_session.live_run_for,
    )
    _graph_registry[graph.root_id] = graph
    return graph


def _load_graph_context(root_id: str) -> tuple[GraphRun, Issue, str] | None:
    """Load the durable header, live root, and resolved module for a graph."""

    try:
        header = GraphRun.objects.get(pk=root_id)
    except GraphRun.DoesNotExist:
        return None
    root = (
        Issue.objects.select_related("project")
        .filter(pk=root_id, type="task")
        .first()
    )
    if root is None:
        return None
    module_id = str(header.module_id) if header.module_id else _module_id_for(root)
    if module_id is None:
        return None
    return header, root, module_id


def _store(state: EngineState) -> EngineState:
    EngineRun.objects.update_or_create(
        task_id=state.task_id,
        defaults={
            "project_id": state.project_id,
            "module_id": state.module_id,
            "agent": state.agent,
            "phase": state.phase,
            "status": state.status,
            "agent_run_id": state.agent_run_id,
            "error": state.error,
        },
    )
    _registry[state.task_id] = state
    return state


def _store_graph(state: GraphState) -> GraphState:
    """Persist the graph header + node rows and mirror into the process cache.

    The ``GraphRun`` header records run context (no edges). Per-node status is
    reused from S1's ``EngineRun`` table with ``phase="implement"`` — one row
    per node that has advanced past ``idle``. Idle nodes are deliberately *not*
    written: an absent row rebuilds to ``idle`` anyway (the re-seed default),
    and writing idle rows would both add noise and make ``generate_leaf_llds``
    skip un-launched leaves (its ``get_state`` relaunch guard).
    """

    GraphRun.objects.update_or_create(
        root_id=state.root_id,
        defaults={
            "project_id": state.project_id,
            "module_id": state.module_id,
            "agent": state.agent,
        },
    )
    for node in state.nodes:
        if node.status == "idle":
            continue
        EngineRun.objects.update_or_create(
            task_id=node.task_id,
            defaults={
                "project_id": state.project_id,
                "module_id": state.module_id,
                "agent": state.agent,
                "phase": "implement",
                "status": node.status,
                "agent_run_id": node.agent_run_id,
                "error": node.error,
            },
        )
    _graph_registry[state.root_id] = state
    return state


def execute(
    task_id: str,
    *,
    agent: str | None,
    phase: Phase = "implement",
    spawn: SpawnRun | None = None,
) -> EngineState:
    """Launch one phase run and return its process-local engine state."""

    issue = (
        Issue.objects.select_related("project").filter(pk=task_id, type="task").first()
    )
    if issue is None:
        raise ValueError("task_not_found")
    module_id = _module_id_for(issue)
    if module_id is None:
        raise ValueError("module_id_required")
    if phase == "refine" and state_group(issue.state_id) != "backlog":
        raise ValueError("task_not_in_backlog")
    if phase == "split" and state_group(issue.state_id) != "unstarted":
        raise ValueError("task_not_in_todo")
    if phase == "register" and issue.lifecycle_state != "hld_approved":
        raise ValueError("task_hld_not_approved")
    if phase == "lld" and state_group(issue.state_id) != "unstarted":
        raise ValueError("task_not_in_todo")

    state = _store(
        EngineState(
            task_id=str(issue.id),
            project_id=str(issue.project_id),
            module_id=module_id,
            agent=agent,
            phase=phase,
        )
    )
    decision = decide(state, SeamEvent(kind="execute_requested", task_id=state.task_id))
    state = _store(decision.next)

    for action in decision.actions:
        state = _apply_launch_action(state, action, spawn or spawn_run, issue)

    return state


def release(task_id: str) -> EngineState:
    """Manually release a wedged one-task planning-run guard (CODIN-755).

    The reducer owns legality: only a registered ``running`` run is a
    releasable lock. On release the driver folds a pure ``release_requested``
    event and then *unregisters* the task, so the guard is fully clear and the
    next launch is a genuinely fresh ``execute``. It returns the previous
    (running) state so callers can report which run was released.

    This is a lock-state mutation only — it never touches tmux or the
    ``AgentRun`` process; a still-live orphan is accepted operator
    responsibility. CODIN-757 retargets this same boundary from ``_registry``
    to the durable ``EngineRun`` row.
    """

    key = str(task_id)
    state = get_state(key)
    if state is None or state.status != "running":
        raise ValueError("planning_run_not_found")

    # Prove the transition is legal through the pure reducer before mutating.
    decide(state, SeamEvent(kind="release_requested", task_id=state.task_id))
    EngineRun.objects.filter(pk=key).delete()
    if key in _registry:
        del _registry[key]
    return state


def execute_graph(
    root_task_id: str,
    *,
    agent: str | None,
    spawn: SpawnRun | None = None,
    live_run_for: LiveRunFor | None = None,
) -> GraphState:
    """Launch the ready set for a root task's dependency subtree."""

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

    live_run_for = live_run_for or terminal_session.live_run_for
    graph = _build_graph_state(root, module_id, agent, live_run_for=live_run_for)
    if not graph.nodes:
        raise ValueError("graph_empty")
    graph = _store_graph(graph)

    decision = decide_graph(
        graph,
        SeamEvent(kind="execute_requested", task_id=graph.root_id),
    )
    graph = _store_graph(decision.next)
    for action in decision.actions:
        graph = _apply_graph_launch_action(
            graph,
            action,
            spawn or spawn_run,
            live_run_for,
        )
    return graph


def generate_leaf_llds(
    root_task_id: str,
    *,
    agent: str | None,
    spawn: SpawnRun | None = None,
) -> list[EngineState]:
    """Launch one ``lld`` run per eligible leaf of an approved split tree.

    A leaf is a non-archived ``type=task`` child of the root sitting in the
    ``unstarted`` (Todo) group — the state #745's register agent lands new
    leaves in. Children that already have an engine state in the registry are
    skipped (relaunch guard). Unlike register's surface-and-halt, leaf-LLD
    generation is independent per leaf: a launch failure is recorded on that
    leaf's state and does not stop the others.
    """

    root = Issue.objects.filter(pk=root_task_id, type="task").first()
    if root is None:
        raise ValueError("task_not_found")

    children = (
        Issue.objects.filter(parent_id=root.id, type="task", is_archived=False)
        .select_related("project", "parent")
        .order_by("sequence_id", "id")
    )

    launched: list[EngineState] = []
    for child in children:
        if state_group(child.state_id) != "unstarted":
            continue
        if get_state(str(child.id)) is not None:
            continue
        try:
            state = execute(
                str(child.id),
                agent=agent,
                phase="lld",
                spawn=spawn,
            )
        except ValueError:
            logger.exception(
                "leaf-lld launch skipped root=%s leaf=%s", root.id, child.id
            )
            continue
        launched.append(state)
    return launched


def observe_issue_state_changed(
    *,
    issue_id: str,
    from_group: str | None,
    to_group: str | None,
    to_state_id: str | None = None,
    spawn: SpawnRun | None = None,
    live_run_for: LiveRunFor | None = None,
) -> EngineState | GraphState | None:
    """Fold a WorkTracker state-change seam event into active local state."""

    live_run_for = live_run_for or terminal_session.live_run_for
    event = SeamEvent(
        kind="issue_state_changed",
        task_id=str(issue_id),
        from_group=from_group,
        to_group=to_group,
        lifecycle_state=_lifecycle_for_state_seam(
            str(issue_id),
            from_group=from_group,
            to_group=to_group,
        ),
    )

    # Review satisfies graph dependencies without completing direct runs.

    review_reached = (
        bool(to_state_id)
        and Issue.objects.filter(
            pk=issue_id,
            state_id=to_state_id,
            state__name=REVIEW_STATE_NAME,
        ).exists()
    )
    graph_event = replace(event, to_group="completed") if review_reached else event

    result: EngineState | GraphState | None = None
    state = get_state(str(issue_id))
    if state is not None:
        decision = decide(state, event)
        next_state = _store(decision.next)
        result = next_state

    for graph in list(_graph_registry.values()):
        if not _graph_contains(graph, str(issue_id)):
            continue
        decision = decide_graph(graph, graph_event)
        next_graph = _store_graph(decision.next)
        for action in decision.actions:
            next_graph = _apply_graph_launch_action(
                next_graph,
                action,
                spawn or spawn_run,
                live_run_for,
            )
        result = next_graph

    return result


def observe_lifecycle_changed(
    *,
    issue_id: str,
    lifecycle_state: str,
    spawn: SpawnRun | None = None,
) -> EngineState | None:
    """Fold a durable lifecycle seam into active one-task state."""

    event = SeamEvent(
        kind="lifecycle_changed",
        task_id=str(issue_id),
        lifecycle_state=lifecycle_state,
    )
    state = get_state(str(issue_id))
    if state is None:
        return None

    decision = decide(state, event)
    next_state = _store(decision.next)
    if (
        state.phase == "split"
        and state.status == "running"
        and next_state.status == "done"
    ):
        return execute(
            next_state.task_id,
            agent=next_state.agent,
            phase="register",
            spawn=spawn,
        )
    return next_state


def _build_graph_state(
    root: Issue,
    module_id: str,
    agent: str | None,
    *,
    live_run_for: LiveRunFor,
) -> GraphState:
    descendants = _task_descendants(root)
    previous_nodes = _durable_node_facts(descendants)
    nodes = tuple(
        _seed_node_from_durable_facts(
            issue,
            previous_nodes.get(str(issue.id)),
            live_run_for=live_run_for,
        )
        for issue in sorted(
            descendants, key=lambda item: (item.sequence_id, str(item.id))
        )
    )

    edges = _dependency_edges(descendants, root=root)

    return GraphState(
        root_id=str(root.id),
        project_id=str(root.project_id),
        module_id=module_id,
        agent=agent,
        nodes=nodes,
        edges=edges,
    )


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


def _durable_node_facts(descendants: list[Issue]) -> dict[str, TaskNode]:
    """Reconstruct per-node status from durable ``EngineRun`` rows (CODIN-777).

    Only ``phase="implement"`` rows count as graph-node state — a leaf may also
    carry a planning-phase row (refine/split/lld) under the same OneToOne
    ``task_id`` key, and that must not be mistaken for implement progress. The
    returned nodes feed ``_seed_node_from_durable_facts`` as its ``previous``,
    which is what makes ``failed``/``halted``/stalled state survive a restart;
    ``done`` and ``running`` are re-derived from the tracker and live
    ``AgentRun`` regardless.
    """

    seq_by_id = {str(issue.id): issue.sequence_id for issue in descendants}
    rows = EngineRun.objects.filter(
        task_id__in=list(seq_by_id), phase="implement"
    ).values_list("task_id", "status", "agent_run_id", "error")
    return {
        str(task_id): TaskNode(
            task_id=str(task_id),
            sequence_id=seq_by_id[str(task_id)],
            status=status,
            agent_run_id=agent_run_id,
            error=error,
        )
        for task_id, status, agent_run_id, error in rows
    }


def _seed_node_from_durable_facts(
    issue: Issue,
    previous: TaskNode | None,
    *,
    live_run_for: LiveRunFor,
) -> TaskNode:
    task_id = str(issue.id)

    # Review satisfies graph blockers like completed workflow states.

    if state_group(issue.state_id) == "completed" or (
        issue.state is not None and issue.state.name == REVIEW_STATE_NAME
    ):
        return TaskNode(
            task_id=task_id,
            sequence_id=issue.sequence_id,
            status="done",
        )

    live_run = live_run_for(task_id)
    if live_run is not None:
        return TaskNode(
            task_id=task_id,
            sequence_id=issue.sequence_id,
            status="running",
            agent_run_id=live_run.id,
        )

    if previous is None:
        return TaskNode(task_id=task_id, sequence_id=issue.sequence_id)

    if previous.status in {"failed", "halted"}:
        return TaskNode(
            task_id=task_id,
            sequence_id=issue.sequence_id,
            status=previous.status,
            error=previous.error,
        )

    if previous.status == "running":
        logger.warning(
            "execution graph run stalled task=%s agent_run_id=%s",
            task_id,
            previous.agent_run_id,
        )
        return TaskNode(
            task_id=task_id,
            sequence_id=issue.sequence_id,
            status="running",
            agent_run_id=previous.agent_run_id,
            error="stalled",
        )

    return TaskNode(task_id=task_id, sequence_id=issue.sequence_id)


def _graph_contains(graph: GraphState, task_id: str) -> bool:
    return any(node.task_id == task_id for node in graph.nodes)


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


def _apply_launch_action(
    state: EngineState,
    action: LaunchAction,
    spawn: SpawnRun,
    issue: Issue,
) -> EngineState:
    try:
        _advance_launch_lifecycle(issue, action.recipe)
        run_id = async_to_sync(spawn)(
            agent=action.agent,
            project_id=action.project_id,
            module_id=action.module_id,
            task_id=action.task_id,
            scope="task",
        )
    except Exception as exc:
        logger.exception("execution launch failed task=%s", action.task_id)
        _try_advance_lifecycle(issue, "failed")
        decision = decide(
            state,
            SeamEvent(
                kind="run_failed",
                task_id=action.task_id,
                error=str(exc) or exc.__class__.__name__,
            ),
        )
    else:
        decision = decide(
            state,
            SeamEvent(
                kind="run_started",
                task_id=action.task_id,
                agent_run_id=run_id,
            ),
        )
    return _store(decision.next)


def _apply_graph_launch_action(
    graph: GraphState,
    action: LaunchAction,
    spawn: SpawnRun,
    live_run_for: LiveRunFor,
) -> GraphState:
    live_run = live_run_for(action.task_id)
    if live_run is not None:
        decision = decide_graph(
            graph,
            SeamEvent(
                kind="run_started",
                task_id=action.task_id,
                agent_run_id=live_run.id,
            ),
        )
        return _store_graph(decision.next)

    issue = Issue.objects.filter(pk=action.task_id, type="task").first()
    if issue is None:
        decision = decide_graph(
            graph,
            SeamEvent(
                kind="run_failed",
                task_id=action.task_id,
                error="task_not_found",
            ),
        )
        return _store_graph(decision.next)

    try:
        _try_advance_lifecycle(issue, "implementing")
        run_id = async_to_sync(spawn)(
            agent=action.agent,
            project_id=action.project_id,
            module_id=action.module_id,
            task_id=action.task_id,
            scope="task",
        )
    except Exception as exc:
        logger.exception("execution graph launch failed task=%s", action.task_id)
        _try_advance_lifecycle(issue, "failed")
        decision = decide_graph(
            graph,
            SeamEvent(
                kind="run_failed",
                task_id=action.task_id,
                error=str(exc) or exc.__class__.__name__,
            ),
        )
    else:
        decision = decide_graph(
            graph,
            SeamEvent(
                kind="run_started",
                task_id=action.task_id,
                agent_run_id=run_id,
            ),
        )
    return _store_graph(decision.next)


def _lifecycle_for_state_seam(
    issue_id: str,
    *,
    from_group: str | None,
    to_group: str | None,
) -> str | None:
    target: str | None = None
    if from_group == "backlog" and to_group == "unstarted":
        target = "prd_approved"
    elif to_group == "completed":
        target = "done"
    elif to_group == "cancelled":
        target = "cancelled"

    if target is None:
        return None

    issue = Issue.objects.filter(pk=issue_id, type="task").first()
    if issue is None:
        return None
    try:
        _advance_lifecycle(issue, target)
    except InvalidTransition:
        logger.exception(
            "execution lifecycle transition rejected task=%s target=%s",
            issue_id,
            target,
        )
        return None
    return target


def _advance_lifecycle(issue: Issue, target: str) -> Issue:
    return set_lifecycle(issue, target)


def _advance_launch_lifecycle(issue: Issue, phase: Phase) -> None:
    target = LAUNCH_LIFECYCLE[phase]
    # Skip when already at the target: a release-then-relaunch (CODIN-755) of the
    # same phase re-enters launch with the lifecycle still parked at that phase's
    # state, and set_lifecycle rejects a self-transition. Re-launching is
    # idempotent for the lifecycle; the spawn below is what makes it a fresh run.
    if target is not None and issue.lifecycle_state != target:
        _advance_lifecycle(issue, target)


def _try_advance_lifecycle(issue: Issue, target: str) -> None:
    try:
        _advance_lifecycle(issue, target)
    except InvalidTransition:
        logger.exception(
            "execution lifecycle transition rejected task=%s target=%s",
            issue.id,
            target,
        )
