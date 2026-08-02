from __future__ import annotations

from typing import Literal

from django.http import JsonResponse
from ninja import Router, Schema, Status

from apps.execution import driver
from apps.terminals.launch import LaunchUnavailable
from apps.settings_store.config import NoConfigurationSelected
from worktracker.auth import ApiKeyAuth


router = Router(tags=["execution"], auth=ApiKeyAuth())


PlanningAgent = Literal["claude", "agy", "codex", "gemini"]


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


class ExecuteGraphOut(Schema):
    root_id: str
    launched: list[str]


class ResetGraphOut(Schema):
    root_id: str
    cleared: list[str]


class DependencyGraphNodeOut(Schema):
    id: str
    state: str
    parent_id: str | None
    blocked_by: list[str]


class DependencyGraphOut(Schema):
    root_id: str
    nodes: list[DependencyGraphNodeOut]


def _error_payload(error: str) -> dict[str, str]:
    return {"error": error, "message": error}


def _value_error_status(error: str) -> int:
    if error in {"task_not_found", "graph_not_found"}:
        return 404
    return 422


@router.post("/work-items/{issue_id}/execute-graph", response={201: ExecuteGraphOut})
def create_execute_graph(request, issue_id: str, payload: ExecuteGraphIn):
    """Arm a root and launch its eligible direct children."""

    try:
        launched = driver.execute_graph(issue_id, agent=payload.agent)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))

    return Status(
        201,
        ExecuteGraphOut(root_id=str(issue_id), launched=launched),
    )


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


@router.delete("/work-items/{issue_id}/execute-graph", response={200: ResetGraphOut})
def reset_execute_graph(request, issue_id: str):
    """Clear a root's launch ledger without launching work."""

    try:
        cleared = driver.reset_subtree(issue_id)
    except ValueError as exc:
        error = str(exc)
        return JsonResponse(_error_payload(error), status=_value_error_status(error))
    return Status(
        200,
        ResetGraphOut(root_id=str(issue_id), cleared=cleared),
    )


@router.post("/work-items/{issue_id}/launch-agent", response={201: LaunchedAgentOut})
def create_launch_agent(request, issue_id: str, payload: LaunchAgentIn):
    """Launch one direct coding session for the target work item (CODIN-924).

    Not the execution engine: this seeds no graph/engine state and moves no
    workflow state — it just starts a normal task-scoped run whose
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
