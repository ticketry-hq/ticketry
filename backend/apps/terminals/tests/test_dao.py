"""Tests for the terminal-sessions Django DAO."""

import pytest

from apps.runs import dao as runs_dao
from apps.runs.models import AgentRun
from apps.terminals import dao
from apps.terminals.models import AgentTerminalSession


pytestmark = pytest.mark.django_db(transaction=True)


def _make_run(
    run_id: str,
    *,
    task_id: str = "task-1",
    lifecycle_state: str | None = None,
) -> AgentRun:
    """Build a parent agent run."""

    return AgentRun(
        id=run_id,
        workspace_slug="meml",
        project_id="proj-1",
        module_id="mod-1",
        task_id=task_id,
        ticket_seq=484,
        agent="claude",
        status="running",
        started_at="2026-05-29T10:00:00",
        cwd="/tmp/work",
        lifecycle_state=lifecycle_state,
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
    await runs_dao.insert_agent_run(
        _make_run(run_id, task_id=task_id, lifecycle_state=kwargs.pop("state", None))
    )
    await dao.insert_terminal_session(
        _make_session(run_id, task_id=task_id, created_at=created_at, **kwargs)
    )


async def test_insert_list_and_soft_delete() -> None:
    await _insert("run-old", "task-1", "2026-05-29T09:00:00")
    await _insert("run-new", "task-1", "2026-05-29T11:00:00")
    await _insert("run-other", "task-2", "2026-05-29T12:00:00")

    listed = await dao.list_terminal_sessions_for_task("task-1")
    deleted = await dao.soft_delete_terminal_session(
        "run-new", terminated_at="2026-05-29T11:30:00"
    )
    listed_after = await dao.list_terminal_sessions_for_task("task-1")

    assert [row.agent_run_id for row in listed] == ["run-new", "run-old"]
    assert deleted is True
    assert [row.agent_run_id for row in listed_after] == ["run-old"]
    assert await dao.soft_delete_terminal_session(
        "run-new", terminated_at="later"
    ) is False
    assert await dao.soft_delete_terminal_session(
        "missing", terminated_at="later"
    ) is False


async def test_parent_delete_cascades_to_terminal_session() -> None:
    await _insert("run-1", "task-1", "2026-05-29T09:00:00")

    await runs_dao.delete_agent_run("run-1")

    assert await AgentTerminalSession.objects.acount() == 0


async def test_list_scratch_sessions_scoped_by_project_and_module() -> None:
    await _insert(
        "plan-1",
        dao.SCRATCH_TASK_ID,
        "2026-05-29T09:00:00",
        scope="plan",
    )
    await _insert(
        "inst-1",
        dao.SCRATCH_TASK_ID,
        "2026-05-29T11:00:00",
        scope="instant",
    )
    await _insert(
        "plan-2",
        dao.SCRATCH_TASK_ID,
        "2026-05-29T12:00:00",
        module_id="mod-2",
        scope="plan",
    )
    await _insert("task-run", "task-1", "2026-05-29T13:00:00")

    listed = await dao.list_scratch_terminal_sessions("proj-1", "mod-1")

    assert [row.agent_run_id for row in listed] == ["inst-1", "plan-1"]
    assert [row.scope for row in listed] == ["instant", "plan"]
