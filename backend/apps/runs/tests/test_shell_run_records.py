"""The run record is valid with a shell scope and no agent (#665).

The panel that will create such runs does not exist yet; what is pinned here is
that the *record* — schema, projection, serializer and status snapshot — already
accepts one, and that agent runs are projected exactly as before.
"""

import pytest

from apps.runs import dao
from apps.runs.models import AgentRun
from apps.runs.run_records import build_run_record
from apps.runs.run_scopes import RUN_SCOPES, SHELL_SCOPE, is_agentless_scope
from apps.terminals.dao import SCRATCH_TASK_ID
from apps.terminals.models import AgentTerminalSession
from studio_server.contracts import RunRecord
from worktracker.tests.factories import ensure_issue, fixture_issue_id, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def issue_graph():
    ensure_issue(project_id="proj-1", module_id="mod-1", task_id=None)
    ensure_issue(project_id="proj-1", module_id="mod-1", task_id="task-1")


def _module_issue_id() -> str:
    return fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id=None)


def _task_issue_id() -> str:
    return fixture_issue_id(project_id="proj-1", module_id="mod-1", task_id="task-1")


async def _insert_shell_run(run_id: str = "run-shell") -> AgentRun:
    """A shell-shaped row: the module's own work item, no agent, shell scope."""

    await dao.insert_agent_run(
        AgentRun(
            id=run_id,
            issue_id=_module_issue_id(),
            agent=None,
            status="running",
            started_at="2026-08-15T10:00:00+00:00",
            scope=SHELL_SCOPE,
        )
    )
    return await AgentRun.objects.select_related("issue").aget(id=run_id)


async def _insert_agent_run(run_id: str = "run-agent") -> AgentRun:
    await dao.insert_agent_run(
        AgentRun(
            id=run_id,
            issue_id=_task_issue_id(),
            agent="claude",
            status="running",
            started_at="2026-08-15T10:00:00+00:00",
            lifecycle_state="working",
            lifecycle_updated_at="2026-08-15T10:00:01+00:00",
            scope="task",
        )
    )
    return await AgentRun.objects.select_related("issue").aget(id=run_id)


async def test_a_run_persists_with_no_agent_under_the_shell_scope() -> None:
    run = await _insert_shell_run()

    assert run.agent is None
    assert run.scope == SHELL_SCOPE


def test_the_shell_scope_is_recognised_and_is_the_agentless_one() -> None:
    assert SHELL_SCOPE in RUN_SCOPES
    assert is_agentless_scope(SHELL_SCOPE)
    for agent_scope in ("task", "plan", "instant", "docchat"):
        assert agent_scope in RUN_SCOPES
        assert not is_agentless_scope(agent_scope)


async def test_a_shell_row_projects_into_a_record_with_a_null_agent() -> None:
    run = await _insert_shell_run()

    record = build_run_record(run, module_id="mod-1")

    assert record.agent is None
    assert record.scope == SHELL_SCOPE
    # A module is itself a work item, so a shell run hangs off the module row
    # and carries no task.
    assert record.task_id is None


async def test_an_agent_row_still_projects_its_provider_and_scope() -> None:
    run = await _insert_agent_run()

    record = build_run_record(run, module_id="mod-1")

    assert record.agent == "claude"
    assert record.scope == "task"
    assert record.state == "working"


def test_the_record_contract_accepts_a_shell_run_without_an_agent() -> None:
    record = RunRecord(
        agent_run_id="run-shell",
        project_id="proj-1",
        task_id=None,
        module_id="mod-1",
        agent=None,
        scope=SHELL_SCOPE,
        started_at="2026-08-15T10:00:00+00:00",
        state="unknown",
        updated_at="2026-08-15T10:00:00+00:00",
    )

    assert record.agent is None
    payload = record.model_dump()
    assert payload["agent"] is None
    assert payload["scope"] == SHELL_SCOPE


async def _mirror(run: AgentRun, *, task_id: str) -> None:
    """Persist the terminal mirror the status snapshot joins a live run to."""

    await AgentTerminalSession.objects.acreate(
        agent_run_id=run.id,
        tmux_session_name=run.id,
        task_id=task_id,
        module_id="mod-1",
        project_id=fixture_uuid("proj-1"),
        agent=run.agent,
        created_at=run.started_at,
        last_output_at=run.started_at,
        runtime_namespace="ns-1",
        scope=run.scope,
    )


async def test_the_terminal_mirror_persists_with_no_agent() -> None:
    run = await _insert_shell_run()

    await _mirror(run, task_id=SCRATCH_TASK_ID)

    session = await AgentTerminalSession.objects.aget(agent_run_id=run.id)
    assert session.agent is None
    assert session.scope == SHELL_SCOPE
    assert session.task_id == SCRATCH_TASK_ID


async def test_the_status_snapshot_carries_shell_and_agent_runs_together() -> None:
    await _mirror(await _insert_shell_run(), task_id=SCRATCH_TASK_ID)
    await _mirror(await _insert_agent_run(), task_id=_task_issue_id())

    records = await dao.agent_status_records(
        fixture_uuid("proj-1"), runtime_namespace="ns-1"
    )

    by_id = {record.agent_run_id: record for record in records}
    # Both rows are ended-or-live tombstones the snapshot must describe; the
    # shell row is present and agentless, the agent row unchanged.
    assert by_id["run-shell"].agent is None
    assert by_id["run-shell"].scope == SHELL_SCOPE
    assert by_id["run-agent"].agent == "claude"


def test_the_scratch_sentinel_is_the_taskless_bucket_a_shell_run_uses() -> None:
    # Pinned so the record slice and the launch slice agree on the sentinel a
    # shell run's terminal mirror carries.
    assert SCRATCH_TASK_ID == "00000000-0000-0000-0000-000000000000"
