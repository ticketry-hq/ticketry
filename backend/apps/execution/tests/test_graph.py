"""Parallel graph-run scheduling: one advancement fans out to every eligible child.

Serial scheduling has its own suite; both share
:mod:`apps.execution.tests.graph_scenarios`.
"""

from __future__ import annotations

import threading
import time

import pytest

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask
from apps.execution.tests.graph_scenarios import (
    _agent_run,
    _successful_spawn,
    _task,
    _terminal_session,
)
from apps.runs.models import AgentRun


pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.usefixtures("clean_registry", "detach_seam_receiver"),
]


def test_chain_releases_one_child_as_each_predecessor_reaches_review(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    a = _task(project, story_type, root, "A", 3, states["todo"])
    b = _task(project, story_type, root, "B", 4, states["todo"])
    c = _task(project, story_type, root, "C", 5, states["todo"])
    b.blocked_by.add(a)
    c.blocked_by.add(b)

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(a.id)]

    a.state = states["review"]
    a.save(update_fields=["state"])
    assert driver.observe_issue_state_changed(
        issue_id=str(a.id), spawn=_successful_spawn
    ) == [str(b.id)]

    b.state = states["review"]
    b.save(update_fields=["state"])
    assert driver.observe_issue_state_changed(
        issue_id=str(b.id), spawn=_successful_spawn
    ) == [str(c.id)]

    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(a.id),
        str(b.id),
        str(c.id),
    ]
    assert set(LaunchedTask.objects.values_list("task_id", flat=True)) == {
        a.id,
        b.id,
        c.id,
    }


def test_fan_out_launches_independent_children_together(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    a = _task(project, story_type, root, "A", 3, states["todo"])
    b = _task(project, story_type, root, "B", 4, states["todo"])

    launched = driver.execute_graph(
        str(root.id), agent="claude", spawn=_successful_spawn
    )

    assert launched == [str(a.id), str(b.id)]
    assert _successful_spawn.calls == [
        {
            "agent": "claude",
            "project_id": str(project.id),
            "module_id": str(module.id),
            "task_id": str(a.id),
            "scope": "task",
        },
        {
            "agent": "claude",
            "project_id": str(project.id),
            "module_id": str(module.id),
            "task_id": str(b.id),
            "scope": "task",
        },
    ]


def test_done_child_satisfies_its_dependent(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    done = _task(project, story_type, root, "Done", 3, states["done"])
    dependent = _task(project, story_type, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(done)

    launched = driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    )

    assert launched == [str(dependent.id)]
    assert not LaunchedTask.objects.filter(task=done).exists()


def test_out_of_subtree_blocker_gates_until_it_is_satisfied(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    external = _task(project, story_type, module, "External", 3, states["todo"])
    dependent = _task(project, story_type, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(external)

    assert (
        driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn) == []
    )

    external.state = states["review"]
    external.save(update_fields=["state"])
    assert driver.advance(str(root.id), spawn=_successful_spawn) == [str(dependent.id)]
    assert [call["task_id"] for call in _successful_spawn.calls] == [str(dependent.id)]


def test_cancelled_and_archived_blockers_do_not_gate(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    cancelled = _task(project, story_type, module, "Cancelled", 3, states["cancelled"])
    archived = _task(
        project,
        story_type,
        module,
        "Archived",
        4,
        states["todo"],
        archived=True,
    )
    dependent = _task(project, story_type, root, "Dependent", 5, states["todo"])
    dependent.blocked_by.add(cancelled, archived)

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(dependent.id)]


def test_grandchildren_never_participate(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["todo"])
    grandchild = _task(project, story_type, child, "Grandchild", 4, states["todo"])

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(child.id)]

    child.state = states["review"]
    child.save(update_fields=["state"])
    assert (
        driver.observe_issue_state_changed(
            issue_id=str(child.id), spawn=_successful_spawn
        )
        == []
    )
    assert [call["task_id"] for call in _successful_spawn.calls] == [str(child.id)]
    assert not LaunchedTask.objects.filter(task=grandchild).exists()


def test_spawn_exception_leaves_no_row_and_later_advance_retries(graph_project):
    project, _, root, states, story_type = graph_project
    retry = _task(project, story_type, root, "Retry", 3, states["todo"])
    independent = _task(project, story_type, root, "Independent", 4, states["todo"])
    calls = []

    async def flaky_spawn(**kwargs):
        calls.append(kwargs["task_id"])
        if kwargs["task_id"] == str(retry.id) and calls.count(str(retry.id)) == 1:
            raise RuntimeError("temporary spawn failure")
        return f"run-{len(calls)}"

    assert driver.execute_graph(str(root.id), agent="codex", spawn=flaky_spawn) == [
        str(independent.id)
    ]
    assert not LaunchedTask.objects.filter(task=retry).exists()
    assert LaunchedTask.objects.filter(task=independent).exists()

    assert driver.advance(str(root.id), spawn=flaky_spawn) == [str(retry.id)]
    assert calls == [str(retry.id), str(independent.id), str(retry.id)]


def test_repeat_execute_refuses_while_launched_child_run_is_active(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["started"])

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(child.id)]
    _agent_run(child, "run-1", active=True)
    assert driver.advance(str(root.id), spawn=_successful_spawn) == []
    with pytest.raises(ValueError, match="^graph_run_exists$"):
        driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    assert [call["task_id"] for call in _successful_spawn.calls] == [str(child.id)]


def test_repeat_execute_revives_an_ended_launched_child(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["started"])

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(child.id)]
    _agent_run(child, "run-1", active=False)

    assert driver.execute_graph(
        str(root.id), agent="claude", spawn=_successful_spawn
    ) == [str(child.id)]
    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(child.id),
        str(child.id),
    ]
    assert LaunchedTask.objects.get(task=child).agent_run_id == "run-2"
    assert GraphRun.objects.get(root=root).agent == "claude"


def test_repeat_execute_refuses_while_a_terminal_session_is_active(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["started"])
    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    run = _agent_run(child, "run-1", active=False)
    _terminal_session(run, project=project, module=module, task=child)

    with pytest.raises(ValueError, match="^graph_run_exists$"):
        driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    assert len(_successful_spawn.calls) == 1


def test_execute_does_not_hold_a_database_transaction_while_spawning(graph_project):
    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["todo"])

    async def database_spawn(**kwargs):
        run_id = "persisted-during-spawn"
        await AgentRun.objects.acreate(
            id=run_id,
            issue_id=kwargs["task_id"],
            ticket_seq=child.sequence_id,
            agent="codex",
            status="running",
            started_at="2026-08-08T10:00:00+00:00",
            scope="task",
        )
        return run_id

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=database_spawn
    ) == [str(child.id)]
    assert AgentRun.objects.filter(id="persisted-during-spawn").exists()
    assert (
        LaunchedTask.objects.get(task=child).agent_run_id
        == "persisted-during-spawn"
    )


def test_reset_subtree_clears_rows_and_launches_nothing(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states, story_type = graph_project
    a = _task(project, story_type, root, "A", 3, states["todo"])
    b = _task(project, story_type, root, "B", 4, states["todo"])
    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    calls_before_reset = list(_successful_spawn.calls)

    cleared = driver.reset_subtree(str(root.id))

    assert cleared == [str(a.id), str(b.id)]
    assert not LaunchedTask.objects.filter(root=root).exists()
    assert _successful_spawn.calls == calls_before_reset
    assert not GraphRun.objects.filter(root=root).exists()


def test_reset_waits_for_an_in_flight_advancement(graph_project):
    """A reset joins the per-root serialization instead of racing a spawn.

    A lifecycle-triggered advancement holds the lock across ``spawn``; a reset
    arriving in that window must wait, so it clears the launch fact the spawn
    records rather than leaving an orphan ledger row behind a deleted header.
    """

    project, _, root, states, story_type = graph_project
    child = _task(project, story_type, root, "Child", 3, states["todo"])
    spawn_entered = threading.Event()

    async def blocking_spawn(**kwargs):
        spawn_entered.set()
        # Hold the advancement inside its lock long enough for the reset to
        # reach that same lock while this launch is still un-recorded.
        time.sleep(0.1)
        return "run-1"

    errors: list[BaseException] = []
    cleared: list[str] = []

    def reset_subtree():
        spawn_entered.wait(timeout=5)
        try:
            cleared.extend(driver.reset_subtree(str(root.id)))
        except BaseException as exc:  # pragma: no cover - surfaced by assertion
            errors.append(exc)

    thread = threading.Thread(target=reset_subtree)
    thread.start()
    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=blocking_spawn
    ) == [str(child.id)]
    thread.join(timeout=10)

    assert errors == []
    assert cleared == [str(child.id)]
    assert not LaunchedTask.objects.filter(root=root).exists()
    assert not GraphRun.objects.filter(root=root).exists()


def test_root_blockers_are_irrelevant(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states, story_type = graph_project
    external = _task(project, story_type, module, "External", 3, states["todo"])
    child = _task(project, story_type, root, "Child", 4, states["todo"])
    root.blocked_by.add(external)

    assert driver.execute_graph(
        str(root.id), agent="codex", spawn=_successful_spawn
    ) == [str(child.id)]


def test_advance_without_an_armed_root_is_a_noop(graph_project):
    _, _, root, _, _ = graph_project

    assert driver.advance(str(root.id), spawn=_successful_spawn) == []


def test_execute_graph_rejects_an_empty_direct_child_set(graph_project):
    _, _, root, _, _ = graph_project

    with pytest.raises(ValueError, match="^graph_empty$"):
        driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert not GraphRun.objects.filter(root=root).exists()


def test_reset_subtree_requires_an_armed_root(graph_project):
    _, _, root, _, _ = graph_project

    with pytest.raises(ValueError, match="^graph_not_found$"):
        driver.reset_subtree(str(root.id))
