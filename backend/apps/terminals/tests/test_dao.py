"""Tests for terminal-run queries over the normalized AgentRun table."""

import pytest
from django.apps import apps as django_apps

from apps.runs import dao as runs_dao
from apps.runs.models import AgentRun
from apps.terminals import dao
from worktracker.tests.factories import fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)


def _make_run(
    run_id: str,
    *,
    task_id: str = "task-1",
    module_id: str = "mod-1",
    started_at: str = "2026-05-29T10:00:00",
    scope: str | None = None,
) -> AgentRun:
    scratch = task_id == dao.SCRATCH_TASK_ID
    return AgentRun(
        id=run_id,
        issue_id=fixture_issue_id(
            project_id="proj-1",
            module_id=module_id,
            task_id=None if scratch else task_id,
        ),
        agent="claude",
        status="running",
        started_at=started_at,
        cwd="/tmp/work",
        scope=scope or ("plan" if scratch else "task"),
        terminal_owner_id="test-owner",
    )


async def _insert(run_id: str, task_id: str, started_at: str, **kwargs) -> None:
    await runs_dao.insert_agent_run(
        _make_run(
            run_id,
            task_id=task_id,
            started_at=started_at,
            **kwargs,
        )
    )


async def test_list_and_soft_delete_use_agent_run_as_source_of_truth() -> None:
    await _insert("run-old", "task-1", "2026-05-29T09:00:00")
    await _insert("run-new", "task-1", "2026-05-29T11:00:00")
    await _insert("run-other", "task-2", "2026-05-29T12:00:00")

    listed = await dao.list_terminal_sessions_for_task(
        fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id="task-1"
        )
    )
    deleted = await dao.soft_delete_terminal_session(
        "run-new", terminated_at="2026-05-29T11:30:00"
    )
    listed_after = await dao.list_terminal_sessions_for_task(
        fixture_issue_id(
            project_id="proj-1", module_id="mod-1", task_id="task-1"
        )
    )

    assert [run.id for run in listed] == ["run-new", "run-old"]
    assert deleted is True
    assert [run.id for run in listed_after] == ["run-old"]
    ended = await AgentRun.objects.aget(id="run-new")
    assert ended.ended_at == "2026-05-29T11:30:00"
    assert ended.lifecycle_state == "exited"
    assert await dao.soft_delete_terminal_session(
        "run-new", terminated_at="later"
    ) is False
    assert await dao.soft_delete_terminal_session(
        "missing", terminated_at="later"
    ) is False


async def test_terminal_metadata_is_derived_from_run_and_issue() -> None:
    await _insert("run-1", "task-1", "2026-05-29T09:00:00")
    run = await AgentRun.objects.select_related("issue").aget(id="run-1")

    assert dao.task_id_for_run(run) == str(run.issue_id)
    assert dao.module_id_for_run(run) == str(run.issue.module_id)
    assert dao.project_id_for_run(run) == str(run.issue.project_id)
    assert run.agent == "claude"
    assert run.scope == "task"
    field_names = {field.name for field in AgentRun._meta.get_fields()}
    assert "ticket_seq" not in field_names
    assert not {"task_id", "module_id", "project_id"} & field_names
    with pytest.raises(LookupError):
        django_apps.get_model("terminals", "AgentTerminalSession")


async def test_provisioning_run_is_hidden_until_transport_is_ready() -> None:
    run = _make_run("run-provisioning", task_id="task-1")
    run.terminal_owner_id = None
    await runs_dao.insert_agent_run(run)

    listed = await dao.list_terminal_sessions_for_task(run.issue_id)

    assert listed == []


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

    listed = await dao.list_scratch_terminal_sessions(
        fixture_uuid("proj-1"),
        fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None),
    )

    assert [run.id for run in listed] == ["inst-1", "plan-1"]
    assert [run.scope for run in listed] == ["instant", "plan"]
