from dataclasses import asdict, dataclass, field
from typing import Dict, List, Literal, Optional


@dataclass
class ModuleSummary:
    id: str
    name: str
    project_id: str


@dataclass
class TaskState:
    name: str
    id: Optional[str] = None
    group: str = ""
    color: Optional[str] = None


@dataclass
class TaskSummary:
    id: str
    name: str
    project_id: str
    state: TaskState
    issue_type: str
    sequence_id: Optional[int] = None
    description: Optional[str] = None
    parent_id: Optional[str] = None
    sub_issues_count: int = 0
    child_count: int = 0
    module_ids: list[str] = field(default_factory=list)


@dataclass
class TaskDetails:
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


@dataclass
class RunRecord:
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


@dataclass
class AgentStatusScope:
    """The authoritative project or task scope covered by a snapshot."""

    project_id: str
    task_id: Optional[str] = None


AutomationAttemptStatus = Literal["pending", "succeeded", "failed"]


@dataclass
class AutomationAttemptRecord:
    """One retry lineage's latest automated-launch outcome."""

    attempt_id: str
    root_attempt_id: str
    work_item_id: str
    status: AutomationAttemptStatus
    updated_at: str
    retry_of_attempt_id: Optional[str] = None
    error: Optional[str] = None
    failure: Optional[dict] = None
    retryable: bool = False
    agent_run_id: Optional[str] = None


@dataclass
class AgentStatusSnapshot:
    """HTTP snapshot body reused by the project status WebSocket."""

    scope: AgentStatusScope
    runs: List[RunRecord]
    at: str
    automation_attempts: List[AutomationAttemptRecord] = field(default_factory=list)


@dataclass
class StatusSnapshotFrame(AgentStatusSnapshot):
    """Versioned project-feed snapshot envelope."""

    v: Literal[1] = 1
    type: Literal["snapshot"] = "snapshot"
    work_item_cursor: int = 0
    workflow_states: List["WorkItemState"] = field(default_factory=list)


@dataclass
class BackendSessionFrame:
    """Versioned explicit server-to-tmux terminal outcome."""

    agent_run_id: str
    status: Literal["exited", "lost"]
    at: str
    v: Literal[1] = 1
    type: Literal["backend_session"] = "backend_session"


@dataclass
class WorkItemState:
    """The complete workflow-state projection consumed by Studio cards."""

    id: str
    name: str
    group: str
    color: Optional[str] = None
    sort_order: int = 0
    is_protected: bool = False


@dataclass
class WorkItemStateFrame:
    """Versioned project-feed delta for one committed work-item change."""

    project_id: str
    work_item_id: str
    state: Optional[WorkItemState]
    revision: int
    updated_at: str
    membership_changed: bool = False
    v: Literal[1] = 1
    type: Literal["work_item_state"] = "work_item_state"


@dataclass
class WorkflowStateFrame:
    """Versioned project-feed delta for one authoritative workflow-state row."""

    project_id: str
    state: WorkItemState
    updated_at: str
    v: Literal[1] = 1
    type: Literal["workflow_state"] = "workflow_state"


@dataclass
class StatusCursorFrame:
    """Marks completion of reconnect replay through one project revision."""

    project_id: str
    revision: int
    v: Literal[1] = 1
    type: Literal["cursor"] = "cursor"


@dataclass
class AutomationAttemptFrame:
    """Versioned project-feed delta for an automated-launch attempt."""

    project_id: str
    attempt: AutomationAttemptRecord
    v: Literal[1] = 1
    type: Literal["automation_attempt"] = "automation_attempt"


def contract_payload(value) -> dict:
    """Convert a dataclass transport contract, including nested values, to JSON data."""

    return asdict(value)
