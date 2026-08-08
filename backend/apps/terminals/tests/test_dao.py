"""Tests for the active terminal-session query used by production."""

import pytest
from asgiref.sync import sync_to_async

from apps.runs.models import AgentRun
from apps.terminals.constants import SCRATCH_TASK_ID
from apps.terminals.models import AgentTerminalSession
from apps.terminals.session import session
from worktracker.tests.factories import fixture_issue_id


pytestmark = pytest.mark.django_db(transaction=True)


def _make_run(
    run_id: str,
    *,
    task_id: str = "task-1",
    module_id: str = "mod-1",
    lifecycle_state: str | None = None,
) -> AgentRun:
    """Build a parent agent run."""

    return AgentRun(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id="proj-1",
            module_id=module_id,
            task_id=None if task_id == SCRATCH_TASK_ID else task_id,
        ),
        ticket_seq=484,
        agent="claude",
        status="running",
        started_at="2026-05-29T10:00:00",
        cwd="/tmp/work",
        lifecycle_state=lifecycle_state,
        scope="plan" if task_id == SCRATCH_TASK_ID else "task",
    )


def _make_session(
    run_id: str,
    *,
    task_id: str,
    created_at: str,
    module_id: str = "mod-1",
    scope: str = "task",
) -> AgentTerminalSession:
    """Build a terminal-session row."""

    return AgentTerminalSession(
        agent_run_id=run_id,
        tmux_session_name=f"pt-{run_id}",
        task_id=task_id,
        module_id=module_id,
        project_id="proj-1",
        agent="claude",
        created_at=created_at,
        scope=scope,
    )


async def _insert(run_id: str, task_id: str, created_at: str, **kwargs) -> None:
    module_id = kwargs.get("module_id", "mod-1")
    run = _make_run(
        run_id,
        task_id=task_id,
        module_id=module_id,
        lifecycle_state=kwargs.pop("state", None),
    )
    await run.asave(force_insert=True)
    await _make_session(run_id, task_id=task_id, created_at=created_at, **kwargs).asave(
        force_insert=True
    )


async def test_list_returns_only_active_sessions_newest_first() -> None:
    await _insert("run-old", "task-1", "2026-05-29T09:00:00")
    await _insert("run-new", "task-1", "2026-05-29T11:00:00")
    await _insert("run-other", "task-2", "2026-05-29T12:00:00")

    listed = await sync_to_async(session.sessions_for)("task-1")
    await AgentTerminalSession.objects.filter(agent_run_id="run-new").aupdate(
        terminated_at="2026-05-29T11:30:00"
    )
    listed_after = await sync_to_async(session.sessions_for)("task-1")

    assert [row.agent_run_id for row in listed] == ["run-new", "run-old"]
    assert [row.agent_run_id for row in listed_after] == ["run-old"]


async def test_parent_delete_cascades_to_terminal_session() -> None:
    await _insert("run-1", "task-1", "2026-05-29T09:00:00")

    await AgentRun.objects.filter(id="run-1").adelete()

    assert await AgentTerminalSession.objects.acount() == 0
