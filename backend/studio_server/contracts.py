from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


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


# The render-facing vocabulary. ``stalled`` is an effective presentation of a
# still-live run whose terminal output has not changed, never a provider
# lifecycle event kind and never persisted as ``lifecycle_state``.
RunPresentationState = Literal[
    "starting",
    "working",
    "needs_input",
    "permission_required",
    "turn_complete",
    "quiet",
    "reconnecting",
    "stalled",
    "exited",
    "error",
    "unknown",
]

# Fixed in this release: a live run whose terminal output identity has not
# changed for this long presents as ``stalled``. The boundary is inclusive.
STALL_AFTER_SECONDS = 60

# A run that already reached one of these can never be overlaid with the
# output-inactivity heuristic — runtime truth outranks it.
_TERMINAL_STATES = frozenset({"exited", "lost", "error"})

# A run waiting on the person at the keyboard is exempt for the opposite
# reason: it already explains its own silence. A waiting terminal produces no
# output by definition, so overlaying it would trade an attention signal for an
# idle one sixty seconds after the agent asked, and never give it back —
# only changed output clears ``stalled``.
_AWAITING_USER_STATES = frozenset({"needs_input", "permission_required"})


def project_effective_state(
    *,
    state: str,
    last_output_at: Optional[str],
    now: Optional[datetime] = None,
) -> str:
    """Overlay the output-inactivity heuristic on one provider lifecycle state.

    The Python mirror of ``projectRunPresentation`` in
    ``studio/src/features/agents/status/runPresentation.ts``. Precedence is
    explicit: a terminal outcome is authoritative, a run waiting on the user
    keeps that attention state, otherwise a live run whose terminal output
    identity has not changed for :data:`STALL_AFTER_SECONDS` projects
    ``stalled``, otherwise the provider lifecycle state is presented.

    :param state: the persisted provider-derived lifecycle state.
    :param last_output_at: backend-owned stamp of the newest changed output,
        or the session creation baseline until real output is observed.
    :param now: reference clock, injectable so the boundary is testable.
    :return: the effective :data:`RunPresentationState`.
    """

    if state in _TERMINAL_STATES or state in _AWAITING_USER_STATES:
        return state
    if not last_output_at:
        return state
    try:
        observed = datetime.fromisoformat(last_output_at.replace("Z", "+00:00"))
    except ValueError:
        return state
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    if (reference - observed).total_seconds() >= STALL_AFTER_SECONDS:
        return "stalled"
    return state


class RunRecord(BaseModel):
    """Transport-neutral status facts for one durable agent run.

    Two axes travel together but are ordered independently: the provider
    lifecycle (``state``/``updated_at``, ordered by lifecycle timestamp) and
    terminal output activity (``output_sequence``/``last_output_at``, ordered
    by the monotonic per-session sequence). Neither timestamp may be used to
    decide the validity of the other axis.
    """

    agent_run_id: str
    project_id: str
    task_id: Optional[str]
    module_id: str
    # Null for a run with no provider — a shell run. Readers must branch on the
    # absence rather than substituting a provider slug (#665).
    agent: Optional[str] = None
    scope: Literal["task", "plan", "instant", "docchat", "shell"]
    started_at: str
    state: LifecycleState
    updated_at: str
    # The hosted command's own result, once one has been observed. Null while
    # the run is live, and null on an ending that recorded no mechanical code
    # (an explicit termination, a missing runtime). A shell run's surface reads
    # it to tell a shell the person exited from one that failed (#670).
    exit_code: Optional[int] = None
    # Write-once launch snapshots (#693): the workflow state this run was
    # launched in and the model its launch configuration actually resolved.
    # Null means "not recorded" — a run created before these were captured, or
    # a scope that has no workflow state or resolved model. Readers must render
    # the absence rather than falling back to the work item's current state or
    # a provider's default model.
    launch_state: Optional[str] = None
    launch_model: Optional[str] = None
    # Terminal output activity axis.
    output_sequence: int = 0
    last_output_at: Optional[str] = None
    # Read-time projection of both axes; clients may recompute it as their own
    # clock passes the inactivity boundary without another server message.
    effective_state: Optional[RunPresentationState] = None

    @model_validator(mode="after")
    def _project_effective_state(self) -> "RunRecord":
        """Fill the read-time projection so every producer agrees on it."""

        if self.effective_state is None:
            object.__setattr__(
                self,
                "effective_state",
                project_effective_state(
                    state=self.state,
                    last_output_at=self.last_output_at,
                ),
            )
        return self


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
    failure: Optional[dict] = None
    retryable: bool = False
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


class TerminalActivityFrame(BaseModel):
    """Versioned terminal-output-activity delta on the project status feed.

    Self-sufficient: it carries the whole run record so a client that missed
    earlier frames can merge it, and mergeable by ``run.output_sequence`` so a
    reordered delivery cannot rewind the activity axis.
    """

    v: Literal[1] = 1
    type: Literal["terminal_activity"] = "terminal_activity"
    at: str
    run: RunRecord


class BackendSessionFrame(BaseModel):
    """Versioned explicit server-to-tmux terminal outcome."""

    v: Literal[1] = 1
    type: Literal["backend_session"] = "backend_session"
    agent_run_id: str
    status: Literal["exited", "lost"]
    at: str
    # The hosted command's exit code when the ending recorded one. A ``lost``
    # runtime and an explicit termination both carry ``None``: neither observed
    # a process result (#670).
    exit_code: Optional[int] = None


class WorkItemState(BaseModel):
    """The complete workflow-state projection consumed by Studio cards."""

    id: str
    name: str
    group: str
    color: Optional[str] = None
    sort_order: int = 0
    is_protected: bool = False


class WorkItemStateFrame(BaseModel):
    """Versioned project-feed delta for one committed work-item change."""

    v: Literal[1] = 1
    type: Literal["work_item_state"] = "work_item_state"
    project_id: str
    work_item_id: str
    state: Optional[WorkItemState]
    revision: int
    updated_at: str
    membership_changed: bool = False


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
