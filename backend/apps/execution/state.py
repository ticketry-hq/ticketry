from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


Status = Literal["idle", "running", "done", "failed", "halted"]
EventKind = Literal[
    "execute_requested",
    "run_started",
    "run_failed",
    "issue_state_changed",
]
ActionKind = Literal["launch"]


@dataclass(frozen=True)
class SeamEvent:
    kind: EventKind
    task_id: str
    project_id: str | None = None
    module_id: str | None = None
    agent: str | None = None
    agent_run_id: str | None = None
    error: str | None = None
    from_group: str | None = None
    to_group: str | None = None


@dataclass(frozen=True)
class LaunchAction:
    kind: ActionKind = "launch"
    task_id: str = ""
    project_id: str = ""
    module_id: str = ""
    agent: str | None = None
