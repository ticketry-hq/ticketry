"""A serial frontier held only by liveness asks for reconciliation (CODING-475).

An agent that exits on its own writes no termination fact; terminal
reconciliation is what discovers it. These tests observe the request the driver
makes when its campaign is waiting on exactly that fact, and — most importantly
— that a campaign in the normal hand-off shape (child reaches Review, agent then
exits) continues without waiting for an unrelated sweep.
"""

from __future__ import annotations

import pytest

from apps.execution import driver, liveness_refresh
from apps.execution.execution_mode import PARALLEL, SERIAL
from apps.execution.models import LaunchedTask
from apps.execution.tests.graph_scenarios import (
    _agent_run,
    _task,
    _terminal_session,
)
from apps.terminals import reconciliation_scheduler
from apps.terminals.persistence import persist_termination


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.usefixtures("clean_registry"),
]

ENDED_AT = "2026-08-10T10:05:00+00:00"


@pytest.fixture
def spawned(monkeypatch):
    calls: list[str] = []

    async def _spawn(**kwargs):
        calls.append(kwargs["task_id"])
        return f"run-{len(calls)}"

    monkeypatch.setattr(driver, "spawn_run", _spawn)
    return calls


@pytest.fixture
def refresh_requests(monkeypatch):
    """Count the reconciliation requests one advancement makes."""

    calls: list[int] = []

    def _request() -> bool:
        calls.append(1)
        return True

    monkeypatch.setattr(driver, "request_terminal_liveness_refresh", _request)
    return calls


def test_satisfied_child_with_a_live_agent_requests_reconciliation(
    graph_project, spawned, refresh_requests
):
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    _task(project, story_type, root, "Second", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)
    assert refresh_requests == []

    first.state = states["review"]
    first.save(update_fields=["state"])

    assert refresh_requests == [1]
    assert spawned == [str(first.id)]


def test_a_requested_sweep_hands_off_to_the_next_child(graph_project, monkeypatch):
    """The recorded termination re-enters the completion seam and advances."""

    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])
    spawned: list[str] = []

    async def _spawn(**kwargs):
        spawned.append(kwargs["task_id"])
        return f"run-{len(spawned)}"

    monkeypatch.setattr(driver, "spawn_run", _spawn)

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)

    def _reconcile_now() -> bool:
        # Stand in for the sweep discovering the exited agent.
        persist_termination("run-1", ended_at=ENDED_AT)
        return True

    monkeypatch.setattr(driver, "request_terminal_liveness_refresh", _reconcile_now)

    # The agent exits silently; only the state change reaches the driver.
    first.state = states["review"]
    first.save(update_fields=["state"])

    assert spawned == [str(first.id), str(second.id)]
    assert LaunchedTask.objects.filter(root=root, task=second).count() == 1


def test_a_live_agent_on_unsatisfied_work_requests_nothing(
    graph_project, spawned, refresh_requests
):
    """Work still in progress is not waiting on a termination fact."""

    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    later = _task(project, story_type, root, "Later", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)

    first.state = states["started"]
    first.save(update_fields=["state"])

    assert refresh_requests == []
    assert not LaunchedTask.objects.filter(task=later).exists()


def test_a_stalled_frontier_requests_nothing(graph_project, spawned, refresh_requests):
    """An ended, unsatisfied child waits for the user, not for a sweep."""

    project, module, root, states, story_type = graph_project
    stalled = _task(project, story_type, root, "Stalled", 4, states["started"])
    _task(project, story_type, root, "Later", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(stalled.id)
    ]
    _agent_run(stalled, "run-1", active=False)
    refresh_requests.clear()

    assert driver.advance(str(root.id)) == []
    assert refresh_requests == []


def test_a_parallel_campaign_requests_nothing(graph_project, spawned, refresh_requests):
    """Parallel fan-out has never waited on agent liveness."""

    project, module, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 4, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=PARALLEL) == [
        str(child.id)
    ]
    run = _agent_run(child, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=child)

    child.state = states["review"]
    child.save(update_fields=["state"])

    assert refresh_requests == []


def test_the_request_reaches_the_terminal_reconciliation_scheduler(monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(
        reconciliation_scheduler,
        "schedule_terminal_reconciliation",
        lambda: calls.append(1) or True,
    )

    assert liveness_refresh.request_terminal_liveness_refresh() is True
    assert calls == [1]


def test_a_failed_request_does_not_break_advancement(monkeypatch):
    def _boom() -> bool:
        raise RuntimeError("scheduler unavailable")

    monkeypatch.setattr(
        reconciliation_scheduler, "schedule_terminal_reconciliation", _boom
    )

    assert liveness_refresh.request_terminal_liveness_refresh() is False
