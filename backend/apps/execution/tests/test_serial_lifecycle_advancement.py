"""Serial campaigns advanced by the live state and completion seams (CODING-465).

These tests drive the *real* wiring: a work-item save emits
``worktracker.signals.issue_state_changed`` and a durable termination write emits
``apps.terminals.termination_seam.agent_run_terminated``. Nothing here calls
``driver.advance`` to make progress, so what is observed is the contract a user
actually gets — which child receives a durable launch fact, and when — rather
than any internal scheduling call.

Both seam receivers stay connected (this suite deliberately omits
``detach_seam_receiver``); the driver's real spawn is replaced so a
signal-triggered launch is recorded instead of starting a terminal.
"""

from __future__ import annotations

import threading

import pytest

from apps.execution import driver
from apps.execution.execution_mode import PARALLEL, SERIAL
from apps.execution.models import LaunchedTask
from apps.execution.tests.graph_scenarios import (
    _agent_run,
    _task,
    _terminal_session,
)
from apps.terminals.persistence import (
    persist_reconciliation_outcome,
    persist_termination,
)
from worktracker.models import Issue


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.usefixtures("clean_registry"),
]

ENDED_AT = "2026-08-08T10:05:00+00:00"
RUNTIME_NAMESPACE = "test-namespace"


@pytest.fixture
def spawned(monkeypatch):
    """Record every launch the seams cause, including signal-triggered ones."""

    calls: list[str] = []

    async def _spawn(**kwargs):
        calls.append(kwargs["task_id"])
        return f"run-{len(calls)}"

    monkeypatch.setattr(driver, "spawn_run", _spawn)
    return calls


def _launched_task_ids(root) -> set:
    return set(
        LaunchedTask.objects.filter(root=root).values_list("task_id", flat=True)
    )


def _satisfy_quietly(task, state) -> None:
    """Reach a satisfying state without emitting the state seam.

    ``QuerySet.update`` skips ``post_save``, which is what lets a test hold one
    of the two progress facts back and then observe the *other* seam releasing
    the frontier.
    """

    Issue.objects.filter(pk=task.id).update(state=state)


def test_satisfaction_then_termination_advances_the_serial_campaign(
    graph_project, spawned
):
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)

    # Fact one: the child is satisfied while its agent is still live.
    first.state = states["review"]
    first.save(update_fields=["state"])

    assert spawned == [str(first.id)]
    assert _launched_task_ids(root) == {first.id}

    # Fact two: termination reaches the completion seam and releases the frontier.
    persist_termination("run-1", ended_at=ENDED_AT)

    assert spawned == [str(first.id), str(second.id)]
    assert _launched_task_ids(root) == {first.id, second.id}


def test_termination_then_satisfaction_advances_the_serial_campaign(
    graph_project, spawned
):
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)

    # Fact one: the agent ends while the child is still unfinished.
    persist_termination("run-1", ended_at=ENDED_AT)

    assert spawned == [str(first.id)]
    assert _launched_task_ids(root) == {first.id}

    # Fact two: satisfaction reaches the state seam and releases the frontier.
    first.state = states["review"]
    first.save(update_fields=["state"])

    assert spawned == [str(first.id), str(second.id)]
    assert _launched_task_ids(root) == {first.id, second.id}


def test_reconciled_terminal_death_advances_the_serial_campaign(
    graph_project, spawned
):
    """Termination discovered by reconciliation reaches the same seam."""

    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(
        run,
        project=project,
        module=module,
        task=first,
        runtime_namespace=RUNTIME_NAMESPACE,
    )
    _satisfy_quietly(first, states["review"])

    assert spawned == [str(first.id)]

    outcome = persist_reconciliation_outcome(
        "run-1",
        ended_at=ENDED_AT,
        exit_code=0,
        runtime_namespace=RUNTIME_NAMESPACE,
    )

    assert outcome.was_active is True
    assert spawned == [str(first.id), str(second.id)]
    assert _launched_task_ids(root) == {first.id, second.id}


def test_a_live_terminal_holds_the_frontier_after_its_run_ended(
    graph_project, spawned
):
    """A run row ending is not enough: the terminal session must be gone too."""

    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=False)
    session = _terminal_session(run, project=project, module=module, task=first)

    first.state = states["review"]
    first.save(update_fields=["state"])

    assert spawned == [str(first.id)]
    assert not LaunchedTask.objects.filter(task=second).exists()

    persist_termination("run-1", ended_at=ENDED_AT)
    session.refresh_from_db()

    assert session.terminated_at == ENDED_AT
    assert spawned == [str(first.id), str(second.id)]


def test_a_repeated_termination_observation_launches_nothing_further(
    graph_project, spawned
):
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])
    third = _task(project, story_type, root, "Third", 6, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(first.id)
    ]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)
    first.state = states["review"]
    first.save(update_fields=["state"])

    persist_termination("run-1", ended_at=ENDED_AT)
    persist_termination("run-1", ended_at="2026-08-08T10:09:00+00:00")
    driver.observe_agent_run_terminated(agent_run_id="run-1")

    assert spawned == [str(first.id), str(second.id)]
    assert not LaunchedTask.objects.filter(task=third).exists()


def test_an_inactive_unsatisfied_child_stalls_until_explicit_revival(
    graph_project, spawned
):
    project, module, root, states, story_type = graph_project
    stalled = _task(project, story_type, root, "Stalled", 4, states["started"])
    later = _task(project, story_type, root, "Later", 5, states["todo"])

    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(stalled.id)
    ]
    run = _agent_run(stalled, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=stalled)

    # Its agent ends without the work ever becoming satisfied. No seam may
    # retry it or skip past it.
    persist_termination("run-1", ended_at=ENDED_AT)
    driver.observe_agent_run_terminated(agent_run_id="run-1")

    assert spawned == [str(stalled.id)]
    assert not LaunchedTask.objects.filter(task=later).exists()

    # Only the user's explicit repeat request revives the same child.
    assert driver.execute_graph(str(root.id), agent="codex", mode=SERIAL) == [
        str(stalled.id)
    ]
    assert spawned == [str(stalled.id), str(stalled.id)]
    assert not LaunchedTask.objects.filter(task=later).exists()


def test_termination_leaves_a_parallel_campaign_unchanged(graph_project, spawned):
    """The completion seam is a serial concern; parallel fan-out is untouched."""

    project, module, root, states, story_type = graph_project
    gate = _task(project, story_type, module, "Gate", 4, states["todo"])
    child = _task(project, story_type, root, "Child", 5, states["todo"])
    dependent = _task(project, story_type, root, "Dependent", 6, states["todo"])
    dependent.blocked_by.add(gate)

    assert driver.execute_graph(str(root.id), agent="codex", mode=PARALLEL) == [
        str(child.id)
    ]
    run = _agent_run(child, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=child)

    # Releasing an out-of-subtree gate makes ``dependent`` eligible without
    # touching this root's own seam.
    gate.state = states["review"]
    gate.save(update_fields=["state"])
    assert spawned == [str(child.id)]

    persist_termination("run-1", ended_at=ENDED_AT)

    assert spawned == [str(child.id)]
    assert not LaunchedTask.objects.filter(task=dependent).exists()

    # Parallel advancement itself still behaves exactly as before.
    child.state = states["review"]
    child.save(update_fields=["state"])

    assert spawned == [str(child.id), str(dependent.id)]


def test_concurrent_manual_and_lifecycle_triggers_launch_one_child(
    graph_project, monkeypatch
):
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])
    third = _task(project, story_type, root, "Third", 6, states["todo"])
    overlap = threading.Barrier(2, timeout=0.5)
    calls_guard = threading.Lock()
    calls: list[str] = []

    async def overlapping_spawn(**kwargs):
        with calls_guard:
            calls.append(kwargs["task_id"])
            attempt = len(calls)
        try:
            # Without per-root serialization both triggers reach this point and
            # each selects a child; with it, the barrier simply times out.
            overlap.wait()
        except threading.BrokenBarrierError:
            pass
        return f"run-{attempt}"

    # The lifecycle trigger reaches the driver's own spawn seam, so both racing
    # advancements must land in the same recorder.
    monkeypatch.setattr(driver, "spawn_run", overlapping_spawn)

    assert driver.execute_graph(
        str(root.id), agent="codex", mode=SERIAL, spawn=overlapping_spawn
    ) == [str(first.id)]
    run = _agent_run(first, "run-1", active=True)
    _terminal_session(run, project=project, module=module, task=first)
    # Hold the satisfaction fact back from the state seam so both the lifecycle
    # observation and the manual request race on the same released frontier.
    _satisfy_quietly(first, states["review"])

    errors: list[BaseException] = []

    def terminate_run():
        try:
            persist_termination("run-1", ended_at=ENDED_AT)
        except BaseException as exc:  # pragma: no cover - surfaced by assertion
            errors.append(exc)

    def request_manually():
        try:
            driver.execute_graph(
                str(root.id), agent="codex", mode=SERIAL, spawn=overlapping_spawn
            )
        except ValueError as exc:
            # A request arriving before the termination commits is refused,
            # which is the existing live-campaign contract.
            if str(exc) != "graph_run_exists":
                errors.append(exc)
        except BaseException as exc:  # pragma: no cover - surfaced by assertion
            errors.append(exc)

    threads = [
        threading.Thread(target=terminate_run),
        threading.Thread(target=request_manually),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert set(calls[1:]) == {str(second.id)}
    assert LaunchedTask.objects.filter(root=root, task=second).count() == 1
    assert not LaunchedTask.objects.filter(task=third).exists()
