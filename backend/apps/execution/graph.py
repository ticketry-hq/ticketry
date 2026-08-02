from __future__ import annotations

from dataclasses import dataclass, field, replace

from apps.execution.state import LaunchAction, SeamEvent, Status


@dataclass(frozen=True)
class TaskNode:
    task_id: str
    sequence_id: int
    status: Status = "idle"
    agent_run_id: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class GraphState:
    root_id: str
    project_id: str
    module_id: str
    agent: str | None  # Optional graph-wide override; None resolves per node.
    nodes: tuple[TaskNode, ...]
    edges: frozenset[tuple[str, str]]


@dataclass(frozen=True)
class GraphDecision:
    next: GraphState
    actions: list[LaunchAction] = field(default_factory=list)


def ready_set(graph: GraphState) -> list[str]:
    """Return idle nodes whose in-graph blockers are done, in stable order."""

    by_id = {node.task_id: node for node in graph.nodes}
    blocked_by: dict[str, set[str]] = {node.task_id: set() for node in graph.nodes}
    for blocker_id, blocked_id in graph.edges:
        if blocker_id in by_id and blocked_id in by_id:
            blocked_by[blocked_id].add(blocker_id)

    ready = [
        node
        for node in graph.nodes
        if node.status == "idle"
        and all(
            by_id[blocker_id].status == "done"
            for blocker_id in blocked_by[node.task_id]
        )
    ]
    return [
        node.task_id for node in sorted(ready, key=lambda n: (n.sequence_id, n.task_id))
    ]


def decide_graph(graph: GraphState, event: SeamEvent) -> GraphDecision:
    """Pure graph transition for ready-set release."""

    if event.kind == "execute_requested":
        if event.task_id != graph.root_id:
            return GraphDecision(next=graph)
        return _with_ready_launches(graph)

    if event.kind == "run_started":
        next_graph = _replace_node(
            graph,
            event.task_id,
            status="running",
            agent_run_id=event.agent_run_id,
            error=None,
        )
        return GraphDecision(next=next_graph)

    if event.kind == "run_failed":
        return GraphDecision(
            next=_fail_node(
                graph,
                event.task_id,
                event.error or "launch_failed",
            )
        )

    if event.kind == "issue_state_changed":
        if not _has_node(graph, event.task_id):
            return GraphDecision(next=graph)
        current = _node(graph, event.task_id)
        if event.to_group == "cancelled" and current.status == "running":
            return GraphDecision(
                next=_fail_node(graph, event.task_id, "task_cancelled")
            )
        if event.to_group != "completed":
            return GraphDecision(next=graph)
        if current.status in {"done", "failed", "halted"}:
            return GraphDecision(next=graph)
        next_graph = _replace_node(
            graph,
            event.task_id,
            status="done",
            error=None,
        )
        return _with_ready_launches(next_graph)

    return GraphDecision(next=graph)


def _with_ready_launches(graph: GraphState) -> GraphDecision:
    actions = [
        LaunchAction(
            task_id=task_id,
            project_id=graph.project_id,
            module_id=graph.module_id,
            agent=graph.agent,
        )
        for task_id in ready_set(graph)
    ]
    return GraphDecision(next=graph, actions=actions)


def _has_node(graph: GraphState, task_id: str) -> bool:
    return any(node.task_id == task_id for node in graph.nodes)


def _node(graph: GraphState, task_id: str) -> TaskNode:
    for node in graph.nodes:
        if node.task_id == task_id:
            return node
    raise KeyError(task_id)


def _replace_node(graph: GraphState, task_id: str, **changes) -> GraphState:
    nodes = tuple(
        replace(node, **changes) if node.task_id == task_id else node
        for node in graph.nodes
    )
    return replace(graph, nodes=nodes)


def _fail_node(graph: GraphState, task_id: str, error: str) -> GraphState:
    if not _has_node(graph, task_id):
        return graph
    failed = _replace_node(
        graph,
        task_id,
        status="failed",
        agent_run_id=None,
        error=error,
    )
    return _halt_idle_dependents(failed, task_id)


def _halt_idle_dependents(graph: GraphState, failed_task_id: str) -> GraphState:
    outgoing: dict[str, set[str]] = {node.task_id: set() for node in graph.nodes}
    for blocker_id, blocked_id in graph.edges:
        if blocker_id in outgoing and blocked_id in outgoing:
            outgoing[blocker_id].add(blocked_id)

    halted: set[str] = set()
    frontier = list(outgoing.get(failed_task_id, ()))
    while frontier:
        task_id = frontier.pop()
        if task_id in halted:
            continue
        halted.add(task_id)
        frontier.extend(outgoing.get(task_id, ()))

    if not halted:
        return graph

    nodes = tuple(
        replace(node, status="halted")
        if node.task_id in halted and node.status == "idle"
        else node
        for node in graph.nodes
    )
    return replace(graph, nodes=nodes)
