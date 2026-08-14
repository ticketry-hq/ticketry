"""The composed Run Now capability shared by HTTP and MCP callers."""

from __future__ import annotations

from dataclasses import dataclass
import re
from threading import Lock
from weakref import WeakValueDictionary

from django.core.exceptions import ValidationError as DjangoValidationError

from apps.execution import auto_start_suppression, driver
from apps.runs.models import AgentRun
from apps.settings_store.config import NoConfigurationSelected
from apps.terminals.agents.skills.preflight import RequiredSkillUnavailable
from apps.terminals.launch import LaunchUnavailable
from apps.terminals.models import AgentTerminalSession
from apps.terminals.task_launch_preflight import preflight_task_launch
from worktracker.models import Issue, State
from worktracker.services.work_items import update_work_item


_RUN_NOW_LOCKS: WeakValueDictionary[str, Lock] = WeakValueDictionary()
_RUN_NOW_LOCKS_GUARD = Lock()


@dataclass(frozen=True)
class CommittedState:
    id: str
    name: str


@dataclass(frozen=True)
class RunNowResult:
    target_id: str
    committed_state: CommittedState
    run: driver.LaunchResult


class RunNowLaunchFailure(Exception):
    """A launch rejection after the destination state was committed."""

    def __init__(self, committed_state: CommittedState, cause: Exception):
        self.committed_state = committed_state
        self.cause = cause
        super().__init__(str(cause))


def _target_lock(target_id: str) -> Lock:
    with _RUN_NOW_LOCKS_GUARD:
        return _RUN_NOW_LOCKS.setdefault(target_id, Lock())


def _resolve_target(id_or_key: str) -> Issue:
    value = str(id_or_key)
    query = Issue.objects.select_related("issue_type", "state").filter(
        type="task", is_archived=False
    )
    key_match = re.fullmatch(r"([^-]+)-(\d+)", value)
    if key_match:
        slug, sequence = key_match.groups()
        issue = query.filter(
            project__slug__iexact=slug,
            sequence_id=int(sequence),
        ).first()
    else:
        try:
            issue = query.filter(pk=value).first()
        except (DjangoValidationError, TypeError, ValueError):
            issue = None
    if issue is None:
        raise ValueError("task_not_found")
    return issue


def _has_live_work(
    target_id: str,
    *,
    caller_agent_run_id: str | None = None,
) -> bool:
    agent_runs = AgentRun.objects.filter(issue_id=target_id, ended_at__isnull=True)
    terminal_sessions = AgentTerminalSession.objects.filter(
        task_id=target_id,
        terminated_at__isnull=True,
    )
    if caller_agent_run_id is not None:
        agent_runs = agent_runs.exclude(id=caller_agent_run_id)
        terminal_sessions = terminal_sessions.exclude(
            agent_run_id=caller_agent_run_id
        )
    return (
        agent_runs.exists()
        or terminal_sessions.exists()
    )


def execute(
    id_or_key: str,
    *,
    origin: str,
    caller_agent_run_id: str | None = None,
) -> RunNowResult:
    """Preflight, move to Implement through the gate, and launch exactly once."""

    issue = _resolve_target(id_or_key)
    target_id = str(issue.id)
    with _target_lock(target_id):
        issue.refresh_from_db()
        if _has_live_work(
            target_id,
            caller_agent_run_id=caller_agent_run_id,
        ):
            raise ValueError("task_already_active")
        if issue.issue_type.name != "Story" or issue.state.name != "Ideas":
            raise ValueError("run_now_not_eligible")

        module_id = driver._module_id_for(issue)
        if module_id is None:
            raise ValueError("module_id_required")
        destination = State.objects.filter(
            project_id=issue.project_id,
            name="Implement",
        ).first()
        if destination is None:
            raise ValueError("binding_not_configured")

        configuration = driver.resolve_task_launch_configuration(
            target_id,
            destination_state_id=str(destination.id),
        )
        preflight_task_launch(
            module_id=module_id,
            launch_configuration=configuration,
        )
        auto_start_suppression.claim(target_id)
        try:
            committed = update_work_item(
                issue.id,
                state_id=destination.id,
                origin=origin,
            )
        except Exception:
            auto_start_suppression.release(target_id)
            raise
        committed_state = CommittedState(
            id=str(committed.state_id),
            name=committed.state.name,
        )
        try:
            run = driver.launch_task_agent(
                target_id,
                agent=None,
                launch_configuration=configuration,
            )
        except (
            LaunchUnavailable,
            NoConfigurationSelected,
            RequiredSkillUnavailable,
            ValueError,
        ) as exc:
            raise RunNowLaunchFailure(committed_state, exc) from exc
        return RunNowResult(
            target_id=target_id,
            committed_state=committed_state,
            run=run,
        )
