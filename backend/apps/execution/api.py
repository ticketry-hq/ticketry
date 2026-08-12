"""Transport-independent execution application operations used by DRF."""

from __future__ import annotations

from pydantic import BaseModel, field_validator

from apps.execution import driver
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.launch import LaunchUnavailable
from apps.settings_store.config import NoConfigurationSelected
from worktracker.services.errors import ServiceError
class ExecuteGraphIn(BaseModel):
    """Graph-run create request; an omitted ``mode`` means ``parallel``."""

    agent: str | None = None
    mode: str | None = None

    @field_validator("agent", mode="before")
    @classmethod
    def normalize_agent(cls, value):
        if not isinstance(value, str):
            return value
        return value.strip() or None

    @field_validator("mode", mode="before")
    @classmethod
    def normalize_mode(cls, value):
        # Non-text modes stay on the structured ``invalid_execution_mode`` path
        # instead of becoming a shape-level validation error.
        if value is None:
            return None
        if not isinstance(value, str):
            return repr(value)
        return value.strip() or None


class LaunchAgentIn(BaseModel):
    """Optional launch-time provider override; current-state policy is default."""

    agent: str | None = None

    @field_validator("agent", mode="before")
    @classmethod
    def normalize_agent(cls, value):
        if not isinstance(value, str):
            return value
        return value.strip() or None


class LaunchedAgentOut(BaseModel):
    """Durable facts of one direct task-session launch (CODIN-924)."""

    target_id: str
    agent: str
    agent_run_id: str


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

    def __init__(self, error: str, status_code: int):
        super().__init__(status_code, error)
        self.code = error

    def as_body(self):
        return {"detail": self.message, "code": self.code}


def _value_error_status(error: str) -> int:
    if error in {"task_not_found", "graph_not_found"}:
        return 404
    if error == "graph_run_exists":
        return 409
    return 422


def create_execute_graph(issue_id: str, payload: ExecuteGraphIn):
    """Arm a root, or revive it when all prior launches are inactive."""

    try:
        launched = driver.execute_graph(
            issue_id, agent=payload.agent, mode=payload.mode
        )
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


def create_launch_agent(issue_id: str, payload: LaunchAgentIn):
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
    except RequiredSkillUnavailable as exc:
        raise RequiredSkillHttpError(exc) from exc
    except NoConfigurationSelected as exc:
        raise ExecutionHttpError("no_profile_selected", 400) from exc
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


class RequiredSkillHttpError(ServiceError):
    """Expected required-skill rejection shared by launch transports."""

    def __init__(self, rejection: RequiredSkillUnavailable):
        super().__init__(409, rejection.message)
        self.rejection = rejection

    def as_body(self):
        return self.rejection.as_payload()
