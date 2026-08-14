"""Serial graph-run scheduling: at most one live launched child, lowest first.

Every assertion here observes the public scheduling contract — which task ids a
launch call returns, which spawn calls were made, and which durable launch facts
exist — rather than any private selection helper.
"""

from __future__ import annotations

import threading
import uuid

import pytest

from apps.execution import driver
from apps.execution.execution_mode import SERIAL
from apps.execution.models import GraphRun, LaunchedTask
from apps.execution.tests.graph_scenarios import (
    _agent_run,
    _successful_spawn,
    _task,
    _terminal_session,
)
from worktracker.models import IssueType, Project, State


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.usefixtures("clean_registry", "detach_seam_receiver"),
]


def _execute_serially(root, *, agent="codex", spawn=_successful_spawn):
    return driver.execute_graph(str(root.id), agent=agent, mode=SERIAL, spawn=spawn)


def test_serial_launches_only_the_lowest_numbered_ready_child(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    low = _task(project, story_type, root, "Low", 4, states["todo"])
    _task(project, story_type, root, "High", 5, states["todo"])
    _task(project, story_type, root, "Higher", 6, states["todo"])

    assert _execute_serially(root) == [str(low.id)]
    assert _successful_spawn.calls == [
        {
            "agent": "codex",
            "project_id": str(project.id),
            "module_id": str(module.id),
            "task_id": str(low.id),
            "scope": "task",
        }
    ]
    assert set(LaunchedTask.objects.values_list("task_id", flat=True)) == {low.id}
    assert GraphRun.objects.get(root=root).execution_mode == SERIAL


def test_serial_orders_by_sequence_not_by_creation_or_task_id(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    _task(
        project,
        story_type,
        root,
        "Created first, highest id, higher sequence",
        6,
        states["todo"],
        task_id=uuid.UUID("ffffffff-0000-4000-8000-000000000001"),
    )
    lowest_sequence = _task(
        project,
        story_type,
        root,
        "Created last, lowest id, lower sequence",
        5,
        states["todo"],
        task_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
    )

    assert _execute_serially(root) == [str(lowest_sequence.id)]


def test_serial_breaks_a_sequence_tie_on_the_opaque_task_id(graph_project):
    """A tie is only reachable for imported/malformed data.

    ``(project, sequence_id)`` is unique, so this reproduces the tie the way it
    can actually occur: two children of one root whose rows carry the same
    sequence number under different projects.
    """

    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    other_project = Project.objects.create(
        id=uuid.uuid4(),
        workspace=project.workspace,
        name="imported",
        slug="IMPORTED",
    )
    other_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other_project, name="Story", level="task"
    )
    other_state = State.objects.create(
        id=uuid.uuid4(), project=other_project, name="Todo", group="unstarted"
    )
    _task(
        project,
        story_type,
        root,
        "Higher id",
        4,
        states["todo"],
        task_id=uuid.UUID("ffffffff-0000-4000-8000-000000000001"),
    )
    lower_id = _task(
        other_project,
        other_type,
        root,
        "Lower id",
        4,
        other_state,
        task_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
    )

    assert _execute_serially(root) == [str(lower_id.id)]


def test_serial_skips_satisfied_children_and_takes_the_lowest_unsatisfied(
    graph_project,
):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    _task(project, story_type, root, "Done", 4, states["done"])
    _task(project, story_type, root, "Reviewing", 5, states["review"])
    _task(project, story_type, root, "Cancelled", 6, states["cancelled"])
    _task(project, story_type, root, "Archived", 7, states["todo"], archived=True)
    pending = _task(project, story_type, root, "Pending", 8, states["todo"])

    assert _execute_serially(root) == [str(pending.id)]
    assert set(LaunchedTask.objects.values_list("task_id", flat=True)) == {pending.id}


def test_serial_takes_the_lowest_of_children_released_together(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    gate = _task(project, story_type, root, "Gate", 4, states["todo"])
    low = _task(project, story_type, root, "Low", 5, states["todo"])
    high = _task(project, story_type, root, "High", 6, states["todo"])
    low.blocked_by.add(gate)
    high.blocked_by.add(gate)

    assert _execute_serially(root) == [str(gate.id)]

    gate.state = states["review"]
    gate.save(update_fields=["state"])
    _agent_run(gate, "run-1", active=False)

    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(low.id)]
    assert not LaunchedTask.objects.filter(task=high).exists()


def test_serial_respects_a_blocker_outside_the_subtree(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    external = _task(project, story_type, module, "External", 4, states["todo"])
    dependent = _task(project, story_type, root, "Dependent", 5, states["todo"])
    dependent.blocked_by.add(external)

    assert _execute_serially(root) == []

    external.state = states["review"]
    external.save(update_fields=["state"])

    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(dependent.id)]


def test_serial_cancelled_and_archived_blockers_do_not_gate(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    cancelled = _task(project, story_type, module, "Cancelled", 4, states["cancelled"])
    archived = _task(
        project, story_type, module, "Archived", 5, states["todo"], archived=True
    )
    dependent = _task(project, story_type, root, "Dependent", 6, states["todo"])
    dependent.blocked_by.add(cancelled, archived)

    assert _execute_serially(root) == [str(dependent.id)]


def test_serial_never_launches_a_grandchild(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 4, states["todo"])
    grandchild = _task(project, story_type, child, "Grandchild", 5, states["todo"])

    assert _execute_serially(root) == [str(child.id)]

    child.state = states["review"]
    child.save(update_fields=["state"])
    _agent_run(child, "run-1", active=False)

    assert driver.advance(str(root.id), spawn=_successful_spawn) == []
    assert not LaunchedTask.objects.filter(task=grandchild).exists()


def test_serial_waits_while_a_satisfied_child_still_has_a_live_run(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert _execute_serially(root) == [str(first.id)]

    # Satisfaction observed first: Review arrives before the agent exits.
    first.state = states["review"]
    first.save(update_fields=["state"])
    run = _agent_run(first, "run-1", active=True)

    assert driver.advance(str(root.id), spawn=_successful_spawn) == []
    assert not LaunchedTask.objects.filter(task=second).exists()

    run.status = "exited"
    run.ended_at = "2026-08-08T10:05:00+00:00"
    run.save(update_fields=["status", "ended_at"])

    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(second.id)]


def test_serial_waits_while_a_satisfied_child_still_has_a_live_terminal(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert _execute_serially(root) == [str(first.id)]
    first.state = states["review"]
    first.save(update_fields=["state"])
    run = _agent_run(first, "run-1", active=False)
    session = _terminal_session(run, project=project, module=module, task=first)

    assert driver.advance(str(root.id), spawn=_successful_spawn) == []

    session.terminated_at = "2026-08-08T10:06:00+00:00"
    session.save(update_fields=["terminated_at"])

    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(second.id)]


def test_serial_stalls_on_an_ended_child_that_never_became_satisfied(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    first = _task(project, story_type, root, "First", 4, states["todo"])
    second = _task(project, story_type, root, "Second", 5, states["todo"])

    assert _execute_serially(root) == [str(first.id)]

    # Agent termination observed first, with the child still unfinished.
    _agent_run(first, "run-1", active=False)

    assert driver.advance(str(root.id), spawn=_successful_spawn) == []
    assert not LaunchedTask.objects.filter(task=second).exists()

    # Satisfaction arriving second releases the frontier.
    first.state = states["review"]
    first.save(update_fields=["state"])

    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(second.id)]


def test_serial_revival_retries_a_stalled_child_without_skipping_ahead(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    stalled = _task(project, story_type, root, "Stalled", 4, states["started"])
    later = _task(project, story_type, root, "Later", 5, states["todo"])

    assert _execute_serially(root) == [str(stalled.id)]
    _agent_run(stalled, "run-1", active=False)

    assert _execute_serially(root) == [str(stalled.id)]
    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(stalled.id),
        str(stalled.id),
    ]
    assert LaunchedTask.objects.get(task=stalled).agent_run_id == "run-2"
    assert not LaunchedTask.objects.filter(task=later).exists()


def test_serial_repeat_request_is_refused_while_its_child_is_live(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 4, states["started"])
    _task(project, story_type, root, "Later", 5, states["todo"])

    assert _execute_serially(root) == [str(child.id)]
    _agent_run(child, "run-1", active=True)

    with pytest.raises(ValueError, match="^graph_run_exists$"):
        _execute_serially(root)
    assert len(_successful_spawn.calls) == 1


def test_serial_reset_clears_the_campaign_without_launching(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 4, states["todo"])
    _task(project, story_type, root, "Later", 5, states["todo"])

    assert _execute_serially(root) == [str(child.id)]
    calls_before_reset = list(_successful_spawn.calls)

    assert driver.reset_subtree(str(root.id)) == [str(child.id)]
    assert not LaunchedTask.objects.filter(root=root).exists()
    assert not GraphRun.objects.filter(root=root).exists()
    assert _successful_spawn.calls == calls_before_reset


def test_serial_spawn_failure_records_nothing_and_skips_no_candidate(graph_project):
    project, _, root, states, story_type = graph_project
    lowest = _task(project, story_type, root, "Lowest", 4, states["todo"])
    higher = _task(project, story_type, root, "Higher", 5, states["todo"])
    calls: list[str] = []

    async def flaky_spawn(**kwargs):
        calls.append(kwargs["task_id"])
        if calls.count(str(lowest.id)) == 1:
            raise RuntimeError("temporary spawn failure")
        return f"run-{len(calls)}"

    assert _execute_serially(root, spawn=flaky_spawn) == []
    assert calls == [str(lowest.id)]
    assert not LaunchedTask.objects.exists()

    assert driver.advance(str(root.id), spawn=flaky_spawn) == [str(lowest.id)]
    assert not LaunchedTask.objects.filter(task=higher).exists()


def test_concurrent_serial_advancement_launches_exactly_one_child(graph_project):
    project, module, root, states, story_type = graph_project
    gate = _task(project, story_type, module, "Gate", 4, states["todo"])
    low = _task(project, story_type, root, "Low", 5, states["todo"])
    high = _task(project, story_type, root, "High", 6, states["todo"])
    low.blocked_by.add(gate)
    high.blocked_by.add(gate)
    calls: list[str] = []
    calls_guard = threading.Lock()
    overlap = threading.Barrier(2, timeout=0.5)

    async def overlapping_spawn(**kwargs):
        with calls_guard:
            calls.append(kwargs["task_id"])
        try:
            # Without per-root serialization both threads reach this point and
            # select the same child; with it, the barrier simply times out.
            overlap.wait()
        except threading.BrokenBarrierError:
            pass
        return f"run-{len(calls)}"

    assert _execute_serially(root, spawn=overlapping_spawn) == []

    gate.state = states["review"]
    gate.save(update_fields=["state"])

    launched: list[list[str]] = []
    errors: list[BaseException] = []

    def advance_once():
        try:
            launched.append(driver.advance(str(root.id), spawn=overlapping_spawn))
        except BaseException as exc:  # pragma: no cover - surfaced by assertion
            errors.append(exc)

    threads = [threading.Thread(target=advance_once) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert sorted(launched, reverse=True) == [[str(low.id)], []]
    assert calls == [str(low.id)]
    assert list(LaunchedTask.objects.values_list("task_id", flat=True)) == [low.id]
