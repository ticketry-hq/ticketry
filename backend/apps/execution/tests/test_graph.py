from __future__ import annotations

import uuid

import pytest

from apps.execution import driver
from apps.execution.graph import GraphState, TaskNode, decide_graph, ready_set
from apps.execution.signals import observe_completion
from apps.execution.state import SeamEvent
from apps.runs.models import AgentRun
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


@pytest.fixture(autouse=True)
def clean_registry():
    driver.clear_registry()
    yield
    driver.clear_registry()


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


def _graph(nodes, edges=()):
    return GraphState(
        root_id="root",
        project_id="project",
        module_id="module",
        agent="codex",
        nodes=tuple(
            TaskNode(task_id=task_id, sequence_id=sequence, status=status)
            for task_id, sequence, status in nodes
        ),
        edges=frozenset(edges),
    )


def test_ready_set_returns_idle_nodes_whose_blockers_are_done_in_sequence_order():
    graph = _graph(
        [
            ("b", 20, "idle"),
            ("a", 10, "idle"),
            ("done", 5, "done"),
            ("running", 1, "running"),
        ],
        edges={("done", "a"), ("done", "b")},
    )

    assert ready_set(graph) == ["a", "b"]


def test_chain_releases_one_dependent_per_completed_blocker():
    graph = _graph(
        [("a", 1, "idle"), ("b", 2, "idle"), ("c", 3, "idle")],
        edges={("a", "b"), ("b", "c")},
    )

    decision = decide_graph(
        graph,
        SeamEvent(kind="execute_requested", task_id="root"),
    )
    assert [action.task_id for action in decision.actions] == ["a"]

    running_a = decide_graph(
        decision.next,
        SeamEvent(kind="run_started", task_id="a", agent_run_id="run-a"),
    ).next
    after_a = decide_graph(
        running_a,
        SeamEvent(kind="issue_state_changed", task_id="a", to_group="completed"),
    )
    assert [action.task_id for action in after_a.actions] == ["b"]

    running_b = decide_graph(
        after_a.next,
        SeamEvent(kind="run_started", task_id="b", agent_run_id="run-b"),
    ).next
    after_b = decide_graph(
        running_b,
        SeamEvent(kind="issue_state_changed", task_id="b", to_group="completed"),
    )
    assert [action.task_id for action in after_b.actions] == ["c"]


def test_fan_out_releases_all_dependents_together_and_diamond_waits_for_both():
    graph = _graph(
        [
            ("a", 1, "idle"),
            ("b", 2, "idle"),
            ("c", 3, "idle"),
            ("d", 4, "idle"),
        ],
        edges={("a", "b"), ("a", "c"), ("b", "d"), ("c", "d")},
    )

    after_a = decide_graph(
        graph,
        SeamEvent(kind="issue_state_changed", task_id="a", to_group="completed"),
    )
    assert [action.task_id for action in after_a.actions] == ["b", "c"]
    running = after_a.next
    for action in after_a.actions:
        running = decide_graph(
            running,
            SeamEvent(
                kind="run_started",
                task_id=action.task_id,
                agent_run_id=f"run-{action.task_id}",
            ),
        ).next

    after_b = decide_graph(
        running,
        SeamEvent(kind="issue_state_changed", task_id="b", to_group="completed"),
    )
    assert after_b.actions == []

    after_c = decide_graph(
        after_b.next,
        SeamEvent(kind="issue_state_changed", task_id="c", to_group="completed"),
    )
    assert [action.task_id for action in after_c.actions] == ["d"]


def test_failed_blocker_halts_idle_transitive_dependents_only():
    graph = _graph(
        [
            ("a", 1, "running"),
            ("b", 2, "idle"),
            ("c", 3, "running"),
            ("d", 4, "done"),
            ("e", 5, "idle"),
        ],
        edges={("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")},
    )

    decision = decide_graph(
        graph,
        SeamEvent(kind="run_failed", task_id="a", error="boom"),
    )

    assert _node_status(decision.next, "a") == "failed"
    assert _node_status(decision.next, "b") == "halted"
    assert _node_status(decision.next, "c") == "running"
    assert _node_status(decision.next, "d") == "done"
    assert _node_status(decision.next, "e") == "halted"
    assert decision.actions == []


def test_independent_running_branch_continues_after_unrelated_failure():
    graph = _graph(
        [
            ("a", 1, "running"),
            ("b", 2, "idle"),
            ("c", 3, "running"),
            ("d", 4, "idle"),
        ],
        edges={("a", "b"), ("c", "d")},
    )

    failed = decide_graph(
        graph,
        SeamEvent(kind="run_failed", task_id="a", error="boom"),
    ).next
    after_c = decide_graph(
        failed,
        SeamEvent(kind="issue_state_changed", task_id="c", to_group="completed"),
    )

    assert _node_status(after_c.next, "b") == "halted"
    assert _node_status(after_c.next, "c") == "done"
    assert [action.task_id for action in after_c.actions] == ["d"]


def test_cancelled_running_node_marks_failed_and_halts_dependents():
    graph = _graph(
        [("a", 1, "running"), ("b", 2, "idle")],
        edges={("a", "b")},
    )

    decision = decide_graph(
        graph,
        SeamEvent(kind="issue_state_changed", task_id="a", to_group="cancelled"),
    )

    assert _node_status(decision.next, "a") == "failed"
    assert _node_status(decision.next, "b") == "halted"
    assert decision.actions == []


def test_non_completed_and_unknown_events_are_ignored():
    graph = _graph([("a", 1, "running"), ("b", 2, "idle")], edges={("a", "b")})

    started = decide_graph(
        graph,
        SeamEvent(kind="issue_state_changed", task_id="a", to_group="started"),
    )
    unknown = decide_graph(
        graph,
        SeamEvent(kind="issue_state_changed", task_id="other", to_group="completed"),
    )

    assert started.next == graph
    assert started.actions == []
    assert unknown.next == graph
    assert unknown.actions == []


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
        "implement": State.objects.create(
            id=uuid.uuid4(), project=project, name="Implement", group="started"
        ),
        "review": State.objects.create(
            id=uuid.uuid4(), project=project, name="Review", group="started"
        ),
        "done": State.objects.create(
            id=uuid.uuid4(), project=project, name="Done", group="completed"
        ),
    }
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="Module",
        sequence_id=1,
    )
    story_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Story",
        level="task",
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
    return project, module, root, states


def _task(project, parent, name, sequence_id, state=None, archived=False):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        parent=parent,
        state=state,
        name=name,
        sequence_id=sequence_id,
        is_archived=archived,
    )


def test_execute_graph_launches_only_initial_unblocked_chain_node(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])
    b = _task(project, root, "B", 4, states["todo"])
    c = _task(project, root, "C", 5, states["todo"])
    b.blocked_by.add(a)
    c.blocked_by.add(b)

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert [call["task_id"] for call in _successful_spawn.calls] == [str(a.id)]
    assert _nodes_by_status(graph, "running") == [str(a.id)]


def test_graph_completion_releases_dependent_and_drains_chain(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])
    b = _task(project, root, "B", 4, states["todo"])
    c = _task(project, root, "C", 5, states["todo"])
    b.blocked_by.add(a)
    c.blocked_by.add(b)

    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    after_a = driver.observe_issue_state_changed(
        issue_id=str(a.id),
        from_group="started",
        to_group="completed",
        spawn=_successful_spawn,
    )
    after_b = driver.observe_issue_state_changed(
        issue_id=str(b.id),
        from_group="started",
        to_group="completed",
        spawn=_successful_spawn,
    )
    after_c = driver.observe_issue_state_changed(
        issue_id=str(c.id),
        from_group="started",
        to_group="completed",
        spawn=_successful_spawn,
    )

    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(a.id),
        str(b.id),
        str(c.id),
    ]
    assert _node_status(after_a, str(a.id)) == "done"
    assert _node_status(after_b, str(b.id)) == "done"
    assert all(node.status == "done" for node in after_c.nodes)


def test_graph_review_transition_releases_dependent(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    blocker = _task(project, root, "Blocker", 3, states["started"])
    dependent = _task(project, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(blocker)

    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    blocker.state = states["review"]
    blocker.save(update_fields=["state"])
    graph = driver.observe_issue_state_changed(
        issue_id=str(blocker.id),
        from_group="started",
        to_group="started",
        to_state_id=str(states["review"].id),
        spawn=_successful_spawn,
    )

    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(blocker.id),
        str(dependent.id),
    ]
    assert _node_status(graph, str(blocker.id)) == "done"
    assert _node_status(graph, str(dependent.id)) == "running"


def test_execute_graph_fan_out_launches_dependents_in_parallel(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])
    b = _task(project, root, "B", 4, states["todo"])
    c = _task(project, root, "C", 5, states["todo"])
    b.blocked_by.add(a)
    c.blocked_by.add(a)

    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    driver.observe_issue_state_changed(
        issue_id=str(a.id),
        from_group="started",
        to_group="completed",
        spawn=_successful_spawn,
    )

    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(a.id),
        str(b.id),
        str(c.id),
    ]


def test_execute_graph_skips_precompleted_blocker_at_seed_time(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["done"])
    b = _task(project, root, "B", 4, states["todo"])
    b.blocked_by.add(a)

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert [call["task_id"] for call in _successful_spawn.calls] == [str(b.id)]
    assert _node_status(graph, str(a.id)) == "done"
    assert _node_status(graph, str(b.id)) == "running"


def test_execute_graph_skips_blocker_already_in_review_at_seed_time(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    blocker = _task(project, root, "Blocker", 3, states["review"])
    dependent = _task(project, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(blocker)

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert [call["task_id"] for call in _successful_spawn.calls] == [str(dependent.id)]
    assert _node_status(graph, str(blocker.id)) == "done"
    assert _node_status(graph, str(dependent.id)) == "running"


def test_execute_graph_reinvoke_reseeds_review_blocker_as_done(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    blocker = _task(project, root, "Blocker", 3, states["implement"])
    dependent = _task(project, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(blocker)

    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    blocker.state = states["review"]
    blocker.save(update_fields=["state"])
    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert [call["task_id"] for call in _successful_spawn.calls] == [
        str(blocker.id),
        str(dependent.id),
    ]
    assert _node_status(graph, str(blocker.id)) == "done"
    assert _node_status(graph, str(dependent.id)) == "running"


@pytest.mark.parametrize("state_key", ["implement", "started"])
def test_execute_graph_does_not_skip_non_review_started_blocker(
    graph_project, state_key
):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    blocker = _task(project, root, "Blocker", 3, states[state_key])
    dependent = _task(project, root, "Dependent", 4, states["todo"])
    dependent.blocked_by.add(blocker)

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert [call["task_id"] for call in _successful_spawn.calls] == [str(blocker.id)]
    assert _node_status(graph, str(blocker.id)) == "running"
    assert _node_status(graph, str(dependent.id)) == "idle"


def test_execute_graph_ignores_external_blocker_for_this_slice(graph_project):
    _successful_spawn.calls.clear()
    project, module, root, states = graph_project
    external = _task(project, module, "External", 3, states["todo"])
    child = _task(project, root, "Child", 4, states["todo"])
    child.blocked_by.add(external)

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert graph.edges == frozenset()
    assert [call["task_id"] for call in _successful_spawn.calls] == [str(child.id)]


def test_execute_graph_reinvoke_reseeds_running_state_without_new_launches(
    graph_project, caplog
):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])

    first = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    with caplog.at_level("WARNING"):
        second = driver.execute_graph(
            str(root.id), agent="codex", spawn=_successful_spawn
        )

    assert _node_status(first, str(a.id)) == "running"
    assert _node_status(second, str(a.id)) == "running"
    assert _node_error(second, str(a.id)) == "stalled"
    assert "execution graph run stalled" in caplog.text
    assert len(_successful_spawn.calls) == 1


def test_execute_graph_launch_failure_halts_dependents_and_independent_branch_continues(
    graph_project,
):
    calls = []
    project, _, root, states = graph_project
    a = _task(project, root, "A fails", 3, states["todo"])
    b = _task(project, root, "B independent", 4, states["todo"])
    d = _task(project, root, "D blocked", 5, states["todo"])
    d.blocked_by.add(a)

    async def spawn(**kwargs):
        calls.append(kwargs)
        if kwargs["task_id"] == str(a.id):
            raise RuntimeError("tmux unavailable")
        return f"run-{len(calls)}"

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=spawn)
    after_b = driver.observe_issue_state_changed(
        issue_id=str(b.id),
        from_group="started",
        to_group="completed",
        spawn=spawn,
    )

    assert [call["task_id"] for call in calls] == [str(a.id), str(b.id)]
    assert _node_status(graph, str(a.id)) == "failed"
    assert _node_status(graph, str(d.id)) == "halted"
    assert _node_status(after_b, str(b.id)) == "done"


def test_execute_graph_cancelled_running_node_fails_and_halts_dependents(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])
    b = _task(project, root, "B", 4, states["todo"])
    b.blocked_by.add(a)

    driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    graph = driver.observe_issue_state_changed(
        issue_id=str(a.id),
        from_group="started",
        to_group="cancelled",
        spawn=_successful_spawn,
    )

    assert _node_status(graph, str(a.id)) == "failed"
    assert _node_status(graph, str(b.id)) == "halted"
    assert len(_successful_spawn.calls) == 1


def test_execute_graph_adopts_live_agent_run_without_duplicate_launch(graph_project):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    a = _task(project, root, "A", 3, states["todo"])
    run = _agent_run(a, "run-live")

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)
    again = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert _node_status(graph, str(a.id)) == "running"
    assert _node_run_id(graph, str(a.id)) == run.id
    assert _node_run_id(again, str(a.id)) == run.id
    assert _successful_spawn.calls == []


def test_execute_graph_after_registry_reset_seeds_done_adopts_live_and_launches_pending(
    graph_project,
):
    _successful_spawn.calls.clear()
    project, _, root, states = graph_project
    done = _task(project, root, "Done", 3, states["done"])
    running = _task(project, root, "Running", 4, states["todo"])
    pending = _task(project, root, "Pending", 5, states["todo"])
    pending.blocked_by.add(done)
    run = _agent_run(running, "run-live")
    driver.clear_registry()

    graph = driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert _node_status(graph, str(done.id)) == "done"
    assert _node_status(graph, str(running.id)) == "running"
    assert _node_run_id(graph, str(running.id)) == run.id
    assert _node_status(graph, str(pending.id)) == "running"
    assert [call["task_id"] for call in _successful_spawn.calls] == [str(pending.id)]


def test_execute_graph_rejects_empty_subtree_and_does_not_register(graph_project):
    _successful_spawn.calls.clear()
    _, _, root, _ = graph_project

    with pytest.raises(ValueError, match="graph_empty"):
        driver.execute_graph(str(root.id), agent="codex", spawn=_successful_spawn)

    assert driver.get_graph(str(root.id)) is None
    assert _successful_spawn.calls == []


def _node_status(graph, task_id):
    for node in graph.nodes:
        if node.task_id == task_id:
            return node.status
    raise AssertionError(f"missing node {task_id}")


def _node_error(graph, task_id):
    for node in graph.nodes:
        if node.task_id == task_id:
            return node.error
    raise AssertionError(f"missing node {task_id}")


def _node_run_id(graph, task_id):
    for node in graph.nodes:
        if node.task_id == task_id:
            return node.agent_run_id
    raise AssertionError(f"missing node {task_id}")


def _nodes_by_status(graph, status):
    return [node.task_id for node in graph.nodes if node.status == status]


def _agent_run(issue, run_id):
    return AgentRun.objects.create(
        id=run_id,
        project_id=str(issue.project_id),
        module_id=str(issue.parent_id),
        task_id=str(issue.id),
        agent="codex",
        status="running",
        started_at=f"2026-07-02T00:00:0{AgentRun.objects.count()}+00:00",
    )
