from __future__ import annotations

import uuid

import pytest

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask
from apps.execution.signals import observe_completion
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from worktracker.models import (
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    State,
    Workspace,
)
from worktracker.signals import issue_state_changed


pytestmark = pytest.mark.django_db(transaction=True)


def _clear_registry():
    LaunchedTask.objects.all().delete()
    GraphRun.objects.all().delete()


@pytest.fixture(autouse=True)
def clean_registry():
    _clear_registry()
    yield
    _clear_registry()


@pytest.fixture(autouse=True)
def detach_seam_receiver():
    issue_state_changed.disconnect(dispatch_uid="execution_observe_issue_state_changed")
    yield
    issue_state_changed.connect(
        observe_completion,
        dispatch_uid="execution_observe_issue_state_changed",
    )


async def _successful_spawn(**kwargs):
    _successful_spawn.calls.append(kwargs)
    return f"run-{len(_successful_spawn.calls)}"


_successful_spawn.calls = []


@pytest.fixture
def graph_project():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    states = {
        "todo": State.objects.create(
            id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
        ),
        "started": State.objects.create(
            id=uuid.uuid4(), project=project, name="In Progress", group="started"
        ),
        "review": State.objects.create(
            id=uuid.uuid4(), project=project, name="Review", group="started"
        ),
        "done": State.objects.create(
            id=uuid.uuid4(), project=project, name="Done", group="completed"
        ),
        "cancelled": State.objects.create(
            id=uuid.uuid4(), project=project, name="Cancelled", group="cancelled"
        ),
    }
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    story_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Module",
        sequence_id=1,
    )
    LaunchBinding.objects.create(
        issue_type=story_type,
        state=states["todo"],
        subtree_run_enabled=True,
    )
    root = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=story_type,
        parent=module,
        state=states["todo"],
        name="Root",
        sequence_id=2,
    )
    return project, module, root, states, story_type


def _task(
    project,
    issue_type,
    parent,
    name,
    sequence_id,
    state,
    *,
    archived=False,
):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=parent,
        state=state,
        name=name,
        sequence_id=sequence_id,
        is_archived=archived,
    )


def _agent_run(issue, run_id: str, *, active: bool) -> AgentRun:
    return AgentRun.objects.create(
        id=run_id,
        issue=issue,
        ticket_seq=issue.sequence_id,
        agent="codex",
        status="running" if active else "exited",
        started_at="2026-08-08T10:00:00+00:00",
        ended_at=None if active else "2026-08-08T10:05:00+00:00",
        scope="task",
    )


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
    AgentTerminalSession.objects.create(
        agent_run=run,
        tmux_session_name="pt-run-1",
        task_id=str(child.id),
        module_id=str(module.id),
        project_id=str(project.id),
        agent="codex",
        created_at="2026-08-08T10:00:00+00:00",
        terminated_at=None,
        scope="task",
    )

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
