from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ModuleSummary(BaseModel):
    id: str
    name: str
    project_id: str


class TaskState(BaseModel):
    id: Optional[str] = None
    name: str
    group: str = ""
    color: Optional[str] = None


class TaskSummary(BaseModel):
    id: str
    name: str
    project_id: str
    sequence_id: Optional[int] = None
    state: TaskState
    issue_type: str
    description: Optional[str] = None
    parent_id: Optional[str] = None
    sub_issues_count: int = 0


class TaskDetails(BaseModel):
    task: TaskSummary


# Normalized attention state for an agent terminal (ticket #498).
#
# This is the lifecycle axis, kept separate from websocket transport status and
# tmux liveness. The TypeScript mirror is
# studio/src/coding/lib/lifecycle.ts.
LifecycleState = Literal[
    "starting",
    "working",
    "needs_input",
    "permission_required",
    "turn_complete",
    "quiet",
    "reconnecting",
    "exited",
    "error",
    "unknown",
]

# What a per-agent adapter reports happened. The frontend reducer maps a kind to
# a state, so the wire vocabulary stays decoupled from the rendered vocabulary.
LifecycleEventKind = Literal[
    "session_start",
    "turn_start",
    "tool_use",
    "awaiting_input",
    "permission_required",
    "turn_complete",
    "idle",
    "error",
    "session_end",
]


# Single source of truth for kind -> state, mirroring KIND_TO_STATE in
# studio/src/coding/lib/lifecycle.ts. An absent entry means
# "unrecognized".
KIND_TO_STATE: Dict[str, LifecycleState] = {
    "session_start": "starting",
    "turn_start": "working",
    "tool_use": "working",
    "awaiting_input": "needs_input",
    "permission_required": "permission_required",
    "turn_complete": "turn_complete",
    "idle": "quiet",
    "error": "error",
    "session_end": "exited",
}


def reduce_lifecycle(kind: str) -> Optional[LifecycleState]:
    """Reduce an event kind to its lifecycle state.

    The Python mirror of ``reduceLifecycle`` in
    ``studio/src/coding/lib/lifecycle.ts``: maps a
    recognized event kind onto the state it implies. An unrecognized kind
    yields ``None`` so the caller skips the write rather than corrupt state.

    :param kind: The lifecycle event kind to reduce.
    :return: The mapped :data:`LifecycleState`, or ``None`` if unrecognized.
    """

    # Absent kinds degrade to None; the ingress treats that as a no-op.

    return KIND_TO_STATE.get(kind)


class LifecycleEvent(BaseModel):
    """Normalized lifecycle/attention event emitted by a per-agent adapter.

    The shared envelope ingested by the local HTTP endpoint and relayed to the
    web app, where it drives a terminal session's attention state. Carries an
    event *kind*; the consumer decides the resulting state.

    Key characteristics:

    - Keyed to a durable session via ``agent_run_id`` (matches the web app's
      ``SessionMeta.agentRunId``); supports task-bound and scratch sessions.
    - ``kind`` describes what happened; ``message`` is an optional human note.
    - ``source`` records provenance, defaulting to ``hook``; the inactivity
      fallback (ticket #503) reuses this same envelope with ``inactivity``.

    :param agent_run_id: Durable id of the agent run this event refers to.
    :param agent: Which agent produced the event.
    :param kind: The lifecycle transition that occurred.
    :param ts: ISO-8601 timestamp from the emitter's clock.
    :param message: Optional human-readable note about the event.
    :param source: Origin of the event; defaults to a hook script.
    :param provider_session_id: The agent's own resumable session id, when its
        hook exposes one (e.g. Codex's ``session_id`` for ``codex resume``).
    """

    agent_run_id: str
    agent: Literal["claude", "agy", "codex", "gemini"]
    kind: LifecycleEventKind
    ts: str
    message: Optional[str] = None
    source: Literal["hook", "inactivity", "transport"] = "hook"
    provider_session_id: Optional[str] = None


class RunRecord(BaseModel):
    """Transport-neutral latest lifecycle state for one durable agent run."""

    agent_run_id: str
    project_id: str
    task_id: Optional[str]
    module_id: str
    agent: str
    scope: Literal["task", "plan", "instant", "docchat"]
    started_at: str
    state: LifecycleState
    updated_at: str


class AgentStatusScope(BaseModel):
    """The authoritative project or task scope covered by a snapshot."""

    project_id: str
    task_id: Optional[str] = None


AutomationAttemptStatus = Literal["pending", "succeeded", "failed"]


class AutomationAttemptRecord(BaseModel):
    """One retry lineage's latest automated-launch outcome."""

    attempt_id: str
    root_attempt_id: str
    retry_of_attempt_id: Optional[str] = None
    work_item_id: str
    status: AutomationAttemptStatus
    error: Optional[str] = None
    agent_run_id: Optional[str] = None
    updated_at: str


class AgentStatusSnapshot(BaseModel):
    """HTTP snapshot body reused by the project status WebSocket."""

    scope: AgentStatusScope
    runs: List[RunRecord]
    automation_attempts: List[AutomationAttemptRecord] = Field(default_factory=list)
    at: str


class StatusSnapshotFrame(AgentStatusSnapshot):
    """Versioned project-feed snapshot envelope."""

    v: Literal[1] = 1
    type: Literal["snapshot"] = "snapshot"
    work_item_cursor: int = 0
    workflow_states: List["WorkItemState"] = Field(default_factory=list)


class AgentLifecycleFrame(BaseModel):
    """Versioned lifecycle delta carrying a self-sufficient run record."""

    v: Literal[1] = 1
    type: Literal["agent_lifecycle"] = "agent_lifecycle"
    at: str
    run: RunRecord


class BackendSessionFrame(BaseModel):
    """Versioned explicit server-to-tmux terminal outcome."""

    v: Literal[1] = 1
    type: Literal["backend_session"] = "backend_session"
    agent_run_id: str
    status: Literal["exited", "lost"]
    at: str


class WorkItemState(BaseModel):
    """The complete workflow-state projection consumed by Studio cards."""

    id: str
    name: str
    group: str
    color: Optional[str] = None
    sort_order: int = 0
    is_protected: bool = False


class WorkItemStateFrame(BaseModel):
    """Versioned project-feed delta for one committed work-item state move."""

    v: Literal[1] = 1
    type: Literal["work_item_state"] = "work_item_state"
    project_id: str
    work_item_id: str
    state: Optional[WorkItemState]
    revision: int
    updated_at: str


class WorkflowStateFrame(BaseModel):
    """Versioned project-feed delta for one authoritative workflow-state row."""

    v: Literal[1] = 1
    type: Literal["workflow_state"] = "workflow_state"
    project_id: str
    state: WorkItemState
    updated_at: str


class StatusCursorFrame(BaseModel):
    """Marks completion of reconnect replay through one project revision."""

    v: Literal[1] = 1
    type: Literal["cursor"] = "cursor"
    project_id: str
    revision: int


class AutomationAttemptFrame(BaseModel):
    """Versioned project-feed delta for an automated-launch attempt."""

    v: Literal[1] = 1
    type: Literal["automation_attempt"] = "automation_attempt"
    project_id: str
    attempt: AutomationAttemptRecord
