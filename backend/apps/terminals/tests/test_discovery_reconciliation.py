"""Integration coverage for terminal discovery and deferred reconciliation."""

from __future__ import annotations

import pytest

import apps.terminals.api as terminals_api
import apps.terminals.reconciliation as reconciliation
import apps.terminals.reconciliation_scheduler as reconciliation_scheduler
from apps.runs.models import AgentRun
from apps.terminals import dao
from apps.terminals.models import AgentTerminalSession
from apps.terminals.tests.fakes import patch_terminal_runtime
from worktracker.tests.factories import ensure_issue, fixture_uuid


pytestmark = pytest.mark.django_db(transaction=True)

SCRATCH_TASK_ID = dao.SCRATCH_TASK_ID


@pytest.fixture(autouse=True)
def terminal_runtime(monkeypatch):
    return patch_terminal_runtime(monkeypatch)


def _insert_run(run_id, *, task_id="task-1"):
    issue = ensure_issue(
        project_id="proj-1",
        module_id="mod-1",
        task_id=None if task_id == SCRATCH_TASK_ID else task_id,
    )
    AgentRun.objects.create(
        id=run_id,
        issue=issue,
        ticket_seq=484,
        agent="claude-code",
        status="running",
        started_at="2026-05-29T10:00:00",
        cwd="/tmp",
        scope="plan" if task_id == SCRATCH_TASK_ID else "task",
    )


def _insert_session(
    run_id,
    *,
    task_id,
    created_at,
    agent,
    scope="task",
    runtime_namespace="test",
):
    AgentTerminalSession.objects.create(
        agent_run_id=run_id,
        tmux_session_name=f"pt-{run_id}",
        task_id=task_id,
        module_id="mod-1",
        project_id="proj-1",
        agent=agent,
        created_at=created_at,
        scope=scope,
        runtime_namespace=runtime_namespace,
    )
    AgentRun.objects.filter(id=run_id).update(scope=scope)


def _capture_scheduler_jobs(monkeypatch):
    """Drain the process scheduler by hand so sweeps stay deterministic."""

    scheduler = reconciliation_scheduler._scheduler
    jobs: list = []
    monkeypatch.setattr(scheduler, "_submit", jobs.append)
    # A neighbouring test may have left the shared singleton mid-flight.
    monkeypatch.setattr(scheduler, "_in_flight", False)
    monkeypatch.setattr(
        reconciliation_scheduler,
        "close_old_connections",
        lambda: None,
    )
    return jobs


def test_list_terminals_returns_snapshot_then_schedules_reconciliation(
    client, monkeypatch
):
    """GET returns persisted rows without waiting for runtime reconciliation."""

    _insert_run("run-live")
    _insert_run("run-dead")
    _insert_session(
        "run-live",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )
    _insert_session(
        "run-dead", task_id="task-1", created_at="2026-05-29T11:00:00", agent="codex"
    )

    schedule_calls: list[int] = []

    def fake_schedule() -> bool:
        # Soft-deleting from inside the scheduler call pins the ordering: a
        # response materialized after scheduling would have dropped this row.
        schedule_calls.append(1)
        AgentTerminalSession.objects.filter(agent_run_id="run-dead").update(
            terminated_at="2026-05-29T12:00:00"
        )
        return True

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        fake_schedule,
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert schedule_calls == [1]
    assert [row["agent_run_id"] for row in response.json()] == [
        "run-dead",
        "run-live",
    ]


def test_list_terminals_survives_reconcile_submission_failure(client, monkeypatch):
    """A rejected background submission does not fail terminal discovery."""

    _insert_run("run-live")
    _insert_session(
        "run-live",
        task_id="task-1",
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
    )

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        lambda: False,
    )

    response = client.get("/api/terminals", {"task_id": "task-1"})

    assert response.status_code == 200
    assert [row["agent_run_id"] for row in response.json()] == ["run-live"]


def test_list_scratch_terminals_returns_snapshot_then_schedules_reconciliation(
    client, monkeypatch
):
    """Scratch discovery answers from persistence before requesting a sweep."""

    _insert_run("scratch-live", task_id=SCRATCH_TASK_ID)
    _insert_run("scratch-stale", task_id=SCRATCH_TASK_ID)
    _insert_session(
        "scratch-live",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
    )
    _insert_session(
        "scratch-stale",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T11:00:00",
        agent="codex",
        scope="instant",
    )

    schedule_calls: list[int] = []

    def fake_schedule() -> bool:
        # Soft-deleting from inside the scheduler call pins the ordering: a
        # response materialized after scheduling would have dropped this row.
        schedule_calls.append(1)
        AgentTerminalSession.objects.filter(agent_run_id="scratch-stale").update(
            terminated_at="2026-05-29T12:00:00"
        )
        return True

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        fake_schedule,
    )

    response = client.get(
        "/api/terminals/scratch",
        {"project_id": "proj-1", "module_id": "mod-1"},
    )

    assert response.status_code == 200
    assert schedule_calls == [1]
    assert {row["agent_run_id"] for row in response.json()} == {
        "scratch-live",
        "scratch-stale",
    }


def test_list_scratch_terminals_survives_reconcile_submission_failure(
    client, monkeypatch
):
    """A rejected background submission leaves the scratch response untouched."""

    _insert_run("scratch-run", task_id=SCRATCH_TASK_ID)
    _insert_session(
        "scratch-run",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
    )

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        lambda: True,
    )
    scheduled = client.get("/api/terminals/scratch", {"project_id": "proj-1"})

    monkeypatch.setattr(
        terminals_api,
        "schedule_terminal_reconciliation",
        lambda: False,
    )
    rejected = client.get("/api/terminals/scratch", {"project_id": "proj-1"})

    assert scheduled.status_code == rejected.status_code == 200
    assert rejected.json() == scheduled.json()
    assert [row["agent_run_id"] for row in rejected.json()] == ["scratch-run"]


def test_scratch_and_task_discovery_coalesce_on_one_scheduler(client, monkeypatch):
    """Overlapping hydration of both workspaces requests a single sweep."""

    jobs = _capture_scheduler_jobs(monkeypatch)
    reconciled: list[int] = []
    monkeypatch.setattr(
        reconciliation_scheduler._scheduler,
        "_reconcile",
        lambda: reconciled.append(1),
    )

    _insert_run("scratch-run", task_id=SCRATCH_TASK_ID)
    _insert_run("task-run", task_id="task-1")
    _insert_session(
        "scratch-run",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
    )
    _insert_session(
        "task-run",
        task_id="task-1",
        created_at="2026-05-29T11:00:00",
        agent="codex",
    )

    scratch = client.get("/api/terminals/scratch", {"project_id": "proj-1"})
    task = client.get("/api/terminals", {"task_id": "task-1"})

    assert scratch.status_code == task.status_code == 200
    assert [row["agent_run_id"] for row in scratch.json()] == ["scratch-run"]
    assert [row["agent_run_id"] for row in task.json()] == ["task-run"]
    # Both paths reached the same single-flight scheduler, so the second
    # request coalesced instead of queueing a second sweep.
    assert len(jobs) == 1
    # Neither request paid for reconciliation inline.
    assert reconciled == []

    jobs.pop()()

    assert reconciled == [1]


def test_scheduled_sweep_removes_stale_scratch_session(
    client, monkeypatch, terminal_runtime
):
    """A later authoritative sweep retires a scratch session with no runtime."""

    jobs = _capture_scheduler_jobs(monkeypatch)
    _insert_run("scratch-stale", task_id=SCRATCH_TASK_ID)
    _insert_session(
        "scratch-stale",
        task_id=SCRATCH_TASK_ID,
        created_at="2026-05-29T10:00:00",
        agent="claude-code",
        scope="plan",
        runtime_namespace=terminal_runtime.namespace,
    )
    # The runtime never knew this session, so the sweep observes it missing.
    assert "scratch-stale" not in terminal_runtime.present

    first = client.get("/api/terminals/scratch", {"project_id": "proj-1"})

    assert [row["agent_run_id"] for row in first.json()] == ["scratch-stale"]
    assert len(jobs) == 1

    jobs.pop()()

    second = client.get("/api/terminals/scratch", {"project_id": "proj-1"})

    assert second.status_code == 200
    assert second.json() == []
    assert published[0][:3] == (fixture_uuid("proj-1"), "scratch-stale", "lost")
