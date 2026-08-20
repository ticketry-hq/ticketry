"""Transport-independent execution application operations used by DRF."""

from __future__ import annotations

from pydantic import BaseModel

from apps.execution import driver
from apps.execution import run_now
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.launch import LaunchUnavailable, PromptDeliveryFailed
from worktracker.services.errors import ServiceError
class LaunchedAgentOut(BaseModel):
    """Durable facts of one direct task-session launch (CODIN-924)."""

    target_id: str
    agent: str
    agent_run_id: str


class CommittedStateOut(BaseModel):
    id: str
    name: str


class RunNowOut(BaseModel):
    target_id: str
    committed_state: CommittedStateOut
    run: LaunchedAgentOut


class ExecuteGraphOut(BaseModel):
    root_id: str
    launched: list[str]


class ResetGraphOut(BaseModel):
    root_id: str
    cleared: list[str]


class DependencyGraphNodeOut(BaseModel):
    id: str
    state: str
    parent_id: str | None
    blocked_by: list[str]


class DependencyGraphOut(BaseModel):
    root_id: str
    nodes: list[DependencyGraphNodeOut]


class ExecutionHttpError(ServiceError):
    """Stable execution error mapped by the one DRF exception handler."""

    def __init__(self, error: str, status_code: int, *, body: dict | None = None):
        super().__init__(status_code, error)
        self.code = error
        self.body = body

    def as_body(self):
        if self.body is not None:
            return self.body
        return {"detail": self.message, "code": self.code}


class RunNowHttpError(ServiceError):
    """A structured refusal that says whether the workflow move committed."""

    def __init__(
        self,
        *,
        target_id: str,
        status_code: int,
        body: dict,
        committed_state: run_now.CommittedState | None = None,
    ):
        super().__init__(status_code, str(body.get("detail") or body.get("code")))
        self.target_id = target_id
        self.body = body
        self.committed_state = committed_state

    def as_body(self):
        return {
            "target_id": self.target_id,
            "committed_state": (
                {
                    "id": self.committed_state.id,
                    "name": self.committed_state.name,
                }
                if self.committed_state is not None
                else None
            ),
            "run": None,
            **self.body,
        }


def _value_error_status(error: str) -> int:
    if error in {"task_not_found", "graph_not_found"}:
        return 404
    if error == "graph_run_exists":
        return 409
    return 422


def create_execute_graph(
    issue_id: str,
    *,
    agent: str | None = None,
    mode: object = None,
):
    """Arm a root, or advance the campaign it already has.

    An existing campaign is a success, not a conflict; an empty ``launched``
    list is how an inert press is reported. ``graph_run_exists`` survives only
    as the resource-level conflict two concurrent creates can still race into.
    """

    try:
        launched = driver.execute_graph(issue_id, agent=agent, mode=mode)
    except ValueError as exc:
        error = str(exc)
        raise ExecutionHttpError(error, _value_error_status(error)) from exc

    return 201, ExecuteGraphOut(root_id=str(issue_id), launched=launched)


def get_dependency_graph(issue_id: str):
    """Return a read-only workflow-state projection of a task subtree."""

    try:
        graph = driver.get_dependency_graph(issue_id)
    except ValueError as exc:
        error = str(exc)
        raise ExecutionHttpError(error, _value_error_status(error)) from exc

    return 200, DependencyGraphOut(
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
        )


def reset_execute_graph(issue_id: str):
    """Delete a root's run header and launch ledger without launching work."""

    try:
        cleared = driver.reset_subtree(issue_id)
    except ValueError as exc:
        error = str(exc)
        raise ExecutionHttpError(error, _value_error_status(error)) from exc
    return 200, ResetGraphOut(root_id=str(issue_id), cleared=cleared)


def create_launch_agent(issue_id: str, *, agent: str | None = None):
    """Launch one direct coding session for the target work item (CODIN-924).

    Not the execution engine: this seeds no graph/engine state and moves no
    workflow state — it just starts a normal task-scoped run whose
    prompt is built from the target ticket (no caller prompt). Returns 201 with
    the resolved target, the launched agent, and its ``agent_run_id``. Preserves
    the terminal-launch prerequisites as HTTP errors: ``task_not_found`` (404),
    ``module_id_required``/``unknown_agent`` (422), and ``launch_unavailable``
    (503, e.g. tmux down — a partial launch is already
    cleaned up by the terminal seam).
    """

    try:
        result = driver.launch_task_agent(issue_id, agent=agent)
    except RequiredSkillUnavailable as exc:
        raise RequiredSkillHttpError(exc) from exc
    except PromptDeliveryFailed as exc:
        raise ExecutionHttpError(
            exc.code,
            503,
            body=exc.as_payload(),
        ) from exc
    except LaunchUnavailable as exc:
        raise ExecutionHttpError("launch_unavailable", 503) from exc
    except ValueError as exc:
        error = str(exc)
        raise ExecutionHttpError(error, _value_error_status(error)) from exc

    return 201, LaunchedAgentOut(
            target_id=result.target_id,
            agent=result.agent,
            agent_run_id=result.agent_run_id,
        )


def create_run_now(
    issue_id: str,
    *,
    origin: str = "human",
    caller_agent_run_id: str | None = None,
):
    """Move one eligible Story to Implement and launch its pinned policy."""

    try:
        result = run_now.execute(
            issue_id,
            origin=origin,
            caller_agent_run_id=caller_agent_run_id,
        )
    except run_now.RunNowLaunchFailure as exc:
        body, status_code = _run_now_error_body(exc.cause)
        raise RunNowHttpError(
            target_id=str(issue_id),
            status_code=status_code,
            body=body,
            committed_state=exc.committed_state,
        ) from exc
    except Exception as exc:
        body, status_code = _run_now_error_body(exc)
        raise RunNowHttpError(
            target_id=str(issue_id),
            status_code=status_code,
            body=body,
        ) from exc

    return 201, RunNowOut(
        target_id=result.target_id,
        committed_state=CommittedStateOut(
            id=result.committed_state.id,
            name=result.committed_state.name,
        ),
        run=LaunchedAgentOut(
            target_id=result.run.target_id,
            agent=result.run.agent,
            agent_run_id=result.run.agent_run_id,
        ),
    )


def _run_now_error_body(exc: Exception) -> tuple[dict, int]:
    if isinstance(exc, RequiredSkillUnavailable):
        return exc.as_payload(), 409
    if isinstance(exc, PromptDeliveryFailed):
        return exc.as_payload(), 503
    if isinstance(exc, LaunchUnavailable):
        return {"detail": "launch_unavailable", "code": "launch_unavailable"}, 503
    if isinstance(exc, ServiceError):
        body = exc.as_body() if hasattr(exc, "as_body") else {"detail": exc.message}
        return body, exc.status_code
    if isinstance(exc, ValueError):
        code = str(exc)
        status_code = 404 if code == "task_not_found" else 409 if code == "task_already_active" else 422
        return {"detail": code, "code": code}, status_code
    raise exc


class RequiredSkillHttpError(ServiceError):
    """Expected required-skill rejection shared by launch transports."""

    def __init__(self, rejection: RequiredSkillUnavailable):
        super().__init__(409, rejection.message)
        self.rejection = rejection

    def as_body(self):
        return self.rejection.as_payload()
