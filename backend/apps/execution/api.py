from __future__ import annotations

from typing import Literal

from django.http import JsonResponse
from ninja import Router, Schema, Status

from apps.execution import driver
from apps.execution.graph import GraphState
from apps.execution.state import Phase
from apps.terminals.launch import LaunchUnavailable
from apps.settings_store.config import NoConfigurationSelected
from worktracker.auth import ApiKeyAuth


router = Router(tags=["execution"], auth=ApiKeyAuth())


PlanningPhase = Literal["refine", "split"]
PlanningAgent = Literal["claude", "agy", "codex", "gemini"]


class PlanningRunOut(Schema):
    """Execution state; ``agent`` is the optional launch-time override."""

    task_id: str
    project_id: str
    module_id: str
    agent: str | None
    phase: Phase
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class ReleasePlanningRunOut(Schema):
    """Result of releasing a wedged planning-run guard (CODIN-755).

    ``released`` is the previous run that held the lock (its ``status`` is
    ``running``); ``status`` is the task's current guard state after release —
    ``idle``, i.e. the guard is clear and a fresh launch will succeed.
    """

    task_id: str
    status: str
    released: PlanningRunOut


class ExecuteGraphIn(Schema):
    agent: PlanningAgent | None = None


class LaunchAgentIn(Schema):
    """Optional launch-time provider override; current-state policy is default."""

    agent: PlanningAgent | None = None


class LaunchedAgentOut(Schema):
    """Durable facts of one direct task-session launch (CODIN-924)."""

    target_id: str
    agent: str
    agent_run_id: str


class GraphNodeOut(Schema):
    task_id: str
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class GraphOut(Schema):
    """Graph state; null ``agent`` means each node uses its current binding."""

    root_id: str
    project_id: str
    module_id: str
    agent: str | None
    nodes: list[GraphNodeOut]


class DependencyGraphNodeOut(Schema):
    id: str
    state: str
    parent_id: str | None
    blocked_by: list[str]


class DependencyGraphOut(Schema):
    root_id: str
    nodes: list[DependencyGraphNodeOut]


class LeafLldRunOut(Schema):
    task_id: str
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class GenerateLeafLldsOut(Schema):
    root_id: str
    runs: list[LeafLldRunOut]


def _error_payload(error: str) -> dict[str, str]:
    return {"error": error, "message": error}


def _graph_out(graph: GraphState) -> GraphOut:
    return GraphOut(
        root_id=graph.root_id,
        project_id=graph.project_id,
        module_id=graph.module_id,
        agent=graph.agent,
        nodes=[
            GraphNodeOut(
                task_id=node.task_id,
                status=node.status,
                agent_run_id=node.agent_run_id,
                error=node.error,
            )
            for node in graph.nodes
        ],
    )


def _value_error_status(error: str) -> int:
    if error in {"task_not_found", "graph_not_found"}:
        return 404
    return 422


@router.delete(
    "/work-items/{issue_id}/planning-run", response={200: ReleasePlanningRunOut}
)
def release_planning_run(request, issue_id: str):
    """Manually release a wedged ``planning_run_already_running`` guard.

    Clears the process-local lock so the next tracked planning launch is a
    fresh run. Returns 200 with the released run and the now-idle guard, or 404
    ``planning_run_not_found`` when no running planning run is registered. This
    releases the lock only — it never terminates the tmux/AgentRun process.
    """

    try:
        released = driver.release(issue_id)
    except ValueError as exc:
        return JsonResponse(_error_payload(str(exc)), status=404)

    return Status(
        200,
        ReleasePlanningRunOut(
            task_id=released.task_id,
            status="idle",
            released=PlanningRunOut(
                task_id=released.task_id,
                project_id=released.project_id,
                module_id=released.module_id,
                agent=released.agent,
                phase=released.phase,
                status=released.status,
                agent_run_id=released.agent_run_id,
                error=released.error,
            ),
        ),
    )


@router.post("/work-items/{issue_id}/execute-graph", response={201: GraphOut})
def create_execute_graph(request, issue_id: str, payload: ExecuteGraphIn):
    """Launch the ready set of a root task's dependency subtree.

    Idempotent: a re-invoke re-seeds the graph from durable facts (tracker
    completion + live AgentRuns) and launches only genuinely-new work, so
    mashing the button is safe. Always returns 201 with the current state; no
    409 is raised.
    """

    try:
        graph = driver.execute_graph(issue_id, agent=payload.agent)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))

    return Status(201, _graph_out(graph))


@router.get("/work-items/{issue_id}/execute-graph", response={200: GraphOut})
def get_execute_graph(request, issue_id: str):
    """Return the current graph state, or 404 if no graph run exists.

    Durable (CODIN-777): the state is rebuilt from the ``GraphRun`` header, the
    per-node ``EngineRun`` rows, and the live ``blocked_by`` edges, so it
    survives an ASGI restart and reflects the current dependency edges. A 404
    now means no header row exists — never merely "the process restarted".
    """

    graph = driver.get_graph(issue_id)
    if graph is None:
        return JsonResponse(_error_payload("graph_not_found"), status=404)
    return Status(200, _graph_out(graph))


@router.get(
    "/work-items/{issue_id}/dependency-graph", response={200: DependencyGraphOut}
)
def get_dependency_graph(request, issue_id: str):
    """Return a read-only workflow-state projection of a task subtree."""

    try:
        graph = driver.get_dependency_graph(issue_id)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))

    return Status(
        200,
        DependencyGraphOut(
            root_id=graph.root_id,
            nodes=[
                DependencyGraphNodeOut(
                    id=node.id,
                    state=node.state,
                    parent_id=node.parent_id,
                    blocked_by=list(node.blocked_by),
                )
                for node in graph.nodes
            ],
        ),
    )


@router.delete("/work-items/{issue_id}/execute-graph", response={200: GraphOut})
def reset_execute_graph(request, issue_id: str):
    """Re-arm failed and dependency-halted nodes without launching work."""

    try:
        graph = driver.reset_graph(issue_id)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))
    return Status(200, _graph_out(graph))


@router.post(
    "/work-items/{issue_id}/generate-leaf-llds",
    response={201: GenerateLeafLldsOut},
)
def create_generate_leaf_llds(request, issue_id: str, payload: ExecuteGraphIn):
    """Launch one ``lld`` run per eligible leaf of an approved split tree."""

    try:
        states = driver.generate_leaf_llds(issue_id, agent=payload.agent)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))

    return Status(
        201,
        GenerateLeafLldsOut(
            root_id=issue_id,
            runs=[
                LeafLldRunOut(
                    task_id=state.task_id,
                    status=state.status,
                    agent_run_id=state.agent_run_id,
                    error=state.error,
                )
                for state in states
            ],
        ),
    )


@router.post("/work-items/{issue_id}/launch-agent", response={201: LaunchedAgentOut})
def create_launch_agent(request, issue_id: str, payload: LaunchAgentIn):
    """Launch one direct coding session for the target work item (CODIN-924).

    Not the execution engine: this seeds no graph/engine state and moves no
    workflow/lifecycle state — it just starts a normal task-scoped run whose
    prompt is built from the target ticket (no caller prompt). Returns 201 with
    the resolved target, the launched agent, and its ``agent_run_id``. Preserves
    the terminal-launch prerequisites as HTTP errors: ``task_not_found`` (404),
    ``module_id_required``/``unknown_agent`` (422), ``no_profile_selected`` (400),
    and ``launch_unavailable`` (503, e.g. tmux down — a partial launch is already
    cleaned up by the terminal seam).
    """

    try:
        result = driver.launch_task_agent(issue_id, agent=payload.agent)
    except NoConfigurationSelected:
        return JsonResponse(_error_payload("no_profile_selected"), status=400)
    except LaunchUnavailable:
        return JsonResponse(_error_payload("launch_unavailable"), status=503)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))

    return Status(
        201,
        LaunchedAgentOut(
            target_id=result.target_id,
            agent=result.agent,
            agent_run_id=result.agent_run_id,
        ),
    )
