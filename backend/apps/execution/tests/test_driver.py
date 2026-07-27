from __future__ import annotations

import uuid

import pytest

from apps.execution import driver
from apps.execution.signals import observe_completion
from worktracker.models import Issue, Project, State, Workspace
from worktracker.signals import issue_state_changed

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def clean_registry():
    driver.clear_registry()
    yield
    driver.clear_registry()


@pytest.fixture(autouse=True)
def detach_seam_receiver():
    """Drive seam events explicitly; the live receiver would consume the
    on-commit signal first (transaction=True) and race these unit tests."""

    issue_state_changed.disconnect(
        dispatch_uid="execution_observe_issue_state_changed"
    )
    yield
    issue_state_changed.connect(
        observe_completion,
        dispatch_uid="execution_observe_issue_state_changed",
    )


@pytest.fixture
def task():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        name="Module",
        sequence_id=1,
    )
    backlog = State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Backlog",
        group="backlog",
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        parent=module,
        state=backlog,
        lifecycle_state="backlog",
        name="Task",
        sequence_id=2,
        description="Raw idea",
    )
    return issue


@pytest.fixture
def subtask(task):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        type="task",
        parent=task,
        name="Subtask",
        sequence_id=3,
    )


async def _successful_spawn(**kwargs):
    _successful_spawn.calls.append(kwargs)
    return "run-1"


_successful_spawn.calls = []


async def _failing_spawn(**kwargs):
    raise RuntimeError("tmux unavailable")


def test_execute_loads_task_calls_spawn_once_and_returns_running(task):
    _successful_spawn.calls.clear()

    state = driver.execute(str(task.id), agent="codex", spawn=_successful_spawn)

    assert state.status == "running"
    assert state.agent_run_id == "run-1"
    assert state.task_id == str(task.id)
    assert state.project_id == str(task.project_id)
    assert state.module_id == str(task.parent_id)
    assert state.agent == "codex"
    assert driver.get_state(str(task.id)) == state
    assert _successful_spawn.calls == [
        {
            "agent": "codex",
            "project_id": str(task.project_id),
            "module_id": str(task.parent_id),
            "task_id": str(task.id),
            "scope": "task",
        }
    ]


def test_execute_refine_leaves_prompt_authority_to_current_state_binding(task):
    _successful_spawn.calls.clear()

    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="refine",
        spawn=_successful_spawn,
    )

    assert state.status == "running"
    assert state.phase == "refine"
    task.refresh_from_db()
    assert task.lifecycle_state == "refining"
    call = _successful_spawn.calls[0]
    assert call["agent"] == "codex"
    assert call["task_id"] == str(task.id)
    assert call["scope"] == "task"
    assert "initial_prompt" not in call


def test_execute_refine_rejects_non_backlog_task(task):
    _successful_spawn.calls.clear()
    todo = State.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        name="Todo",
        group="unstarted",
    )
    task.state = todo
    task.save(update_fields=["state"])

    with pytest.raises(ValueError, match="task_not_in_backlog"):
        driver.execute(str(task.id), agent="codex", phase="refine", spawn=_successful_spawn)

    assert _successful_spawn.calls == []


def test_execute_derives_module_from_subtask_ancestor(task, subtask):
    _successful_spawn.calls.clear()

    state = driver.execute(str(subtask.id), agent="codex", spawn=_successful_spawn)

    assert state.status == "running"
    assert state.module_id == str(task.parent_id)
    assert _successful_spawn.calls[0]["module_id"] == str(task.parent_id)


def test_execute_records_launch_failure(task):
    state = driver.execute(str(task.id), agent="codex", spawn=_failing_spawn)

    assert state.status == "failed"
    assert state.agent_run_id is None
    assert "tmux unavailable" in state.error
    assert driver.get_state(str(task.id)) == state


def test_execute_refine_launch_failure_writes_failed_lifecycle(task):
    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="refine",
        spawn=_failing_spawn,
    )

    assert state.status == "failed"
    task.refresh_from_db()
    assert task.lifecycle_state == "failed"


def test_execute_rejects_missing_or_non_module_task():
    with pytest.raises(ValueError, match="task_not_found"):
        driver.execute(str(uuid.uuid4()), agent="codex", spawn=_successful_spawn)


def test_observe_issue_state_changed_flips_running_task_to_done(task):
    done = State.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        name="Done",
        group="completed",
    )
    task.state = done
    task.lifecycle_state = "implementing"
    task.save(update_fields=["state", "lifecycle_state"])
    state = driver.execute(str(task.id), agent="codex", spawn=_successful_spawn)
    assert state.status == "running"

    observed = driver.observe_issue_state_changed(
        issue_id=str(task.id),
        from_group="started",
        to_group="completed",
    )

    assert observed.status == "done"
    task.refresh_from_db()
    assert task.lifecycle_state == "done"
    assert driver.get_state(str(task.id)).status == "done"


def test_observe_issue_state_changed_ignores_unknown_and_non_completed(task):
    state = driver.execute(str(task.id), agent="codex", spawn=_successful_spawn)

    assert driver.observe_issue_state_changed(
        issue_id=str(uuid.uuid4()),
        from_group="started",
        to_group="completed",
    ) is None
    observed = driver.observe_issue_state_changed(
        issue_id=str(task.id),
        from_group="completed",
        to_group="started",
    )

    assert observed == state


def _move_to_todo(task):
    todo = State.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        name="Todo",
        group="unstarted",
    )
    task.state = todo
    task.lifecycle_state = "prd_approved"
    task.save(update_fields=["state", "lifecycle_state"])
    return todo


def test_execute_split_leaves_prompt_authority_to_current_state_binding(task):
    _successful_spawn.calls.clear()
    todo = _move_to_todo(task)

    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="split",
        spawn=_successful_spawn,
    )

    assert state.status == "running"
    assert state.phase == "split"
    task.refresh_from_db()
    assert task.lifecycle_state == "generating_hld"
    assert task.state_id == todo.id
    call = _successful_spawn.calls[0]
    assert call["agent"] == "codex"
    assert call["task_id"] == str(task.id)
    assert call["scope"] == "task"
    assert "initial_prompt" not in call


def test_execute_split_rejects_non_todo_task(task):
    _successful_spawn.calls.clear()

    with pytest.raises(ValueError, match="task_not_in_todo"):
        driver.execute(str(task.id), agent="codex", phase="split", spawn=_successful_spawn)

    assert _successful_spawn.calls == []


def test_observe_split_completes_on_hld_approved_lifecycle(task):
    _move_to_todo(task)
    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="split",
        spawn=_successful_spawn,
    )
    assert state.status == "running"

    task.lifecycle_state = "hld_approved"
    task.save(update_fields=["lifecycle_state"])

    observed = driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_approved",
        spawn=_successful_spawn,
    )

    # Split completion is transient: it immediately chains into the register
    # launch (#745), so the observable outcome is the register-phase state.
    assert observed.phase == "register"
    assert observed.status == "running"
    task.refresh_from_db()
    assert task.lifecycle_state == "registering_split"


def test_observe_split_ignores_non_hld_approved_lifecycle(task):
    _move_to_todo(task)
    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="split",
        spawn=_successful_spawn,
    )

    observed = driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_review",
    )

    assert observed == state


def test_observe_split_completion_immediately_launches_register(task):
    _successful_spawn.calls.clear()
    _move_to_todo(task)
    driver.execute(str(task.id), agent="codex", phase="split", spawn=_successful_spawn)
    task.lifecycle_state = "hld_approved"
    task.save(update_fields=["lifecycle_state"])

    observed = driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_approved",
        spawn=_successful_spawn,
    )

    assert observed.phase == "register"
    assert observed.status == "running"
    assert driver.get_state(str(task.id)).phase == "register"
    assert len(_successful_spawn.calls) == 2
    register_call = _successful_spawn.calls[1]
    assert register_call["task_id"] == str(task.id)
    assert "initial_prompt" not in register_call


def test_replayed_hld_approval_does_not_relaunch_register(task):
    _successful_spawn.calls.clear()
    _move_to_todo(task)
    driver.execute(str(task.id), agent="codex", phase="split", spawn=_successful_spawn)
    task.lifecycle_state = "hld_approved"
    task.save(update_fields=["lifecycle_state"])
    driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_approved",
        spawn=_successful_spawn,
    )
    assert len(_successful_spawn.calls) == 2

    replayed = driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_approved",
        spawn=_successful_spawn,
    )

    assert replayed.phase == "register"
    assert replayed.status == "running"
    assert len(_successful_spawn.calls) == 2


def test_register_launch_failure_is_recorded(task):
    _move_to_todo(task)
    driver.execute(str(task.id), agent="codex", phase="split", spawn=_successful_spawn)
    task.lifecycle_state = "hld_approved"
    task.save(update_fields=["lifecycle_state"])

    observed = driver.observe_lifecycle_changed(
        issue_id=str(task.id),
        lifecycle_state="hld_approved",
        spawn=_failing_spawn,
    )

    assert observed.phase == "register"
    assert observed.status == "failed"
    assert "tmux unavailable" in observed.error


def test_execute_register_rejects_task_without_hld_approval(task):
    _successful_spawn.calls.clear()
    _move_to_todo(task)

    with pytest.raises(ValueError, match="task_hld_not_approved"):
        driver.execute(
            str(task.id), agent="codex", phase="register", spawn=_successful_spawn
        )

    assert _successful_spawn.calls == []


def _make_todo_state(project):
    return State.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Todo",
        group="unstarted",
    )


def _leaf(task, todo, *, seq, name="Leaf", state=None, archived=False):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        type="task",
        parent=task,
        state=state if state is not None else todo,
        lifecycle_state="split_created"
        if (state is None or state.group == "unstarted")
        else None,
        name=name,
        sequence_id=seq,
        description=f"{name} scope",
        is_archived=archived,
    )


def test_generate_leaf_llds_launches_one_lld_run_per_todo_leaf(task):
    _successful_spawn.calls.clear()
    todo = _make_todo_state(task.project)
    backlog = task.state  # the fixture's Backlog state
    a = _leaf(task, todo, seq=10, name="Alpha")
    b = _leaf(task, todo, seq=11, name="Bravo")
    c = _leaf(task, todo, seq=12, name="Charlie")
    _leaf(task, todo, seq=13, name="Backlogged", state=backlog)
    _leaf(task, todo, seq=14, name="Archived", archived=True)

    launched = driver.generate_leaf_llds(
        str(task.id), agent="codex", spawn=_successful_spawn
    )

    assert {state.task_id for state in launched} == {str(a.id), str(b.id), str(c.id)}
    assert all(state.phase == "lld" for state in launched)
    assert all(state.status == "running" for state in launched)
    assert len(_successful_spawn.calls) == 3
    for leaf in (a, b, c):
        leaf.refresh_from_db()
        assert leaf.lifecycle_state == "lld_generating"

    call = next(c for c in _successful_spawn.calls if c["task_id"] == str(a.id))
    assert call["scope"] == "task"
    assert "initial_prompt" not in call


def test_generate_leaf_llds_skips_children_with_active_engine_state(task):
    _successful_spawn.calls.clear()
    todo = _make_todo_state(task.project)
    a = _leaf(task, todo, seq=10, name="Alpha")
    b = _leaf(task, todo, seq=11, name="Bravo")

    # Pre-launch one leaf so it already carries an engine state.
    driver.execute(str(a.id), agent="codex", phase="lld", spawn=_successful_spawn)
    _successful_spawn.calls.clear()

    launched = driver.generate_leaf_llds(
        str(task.id), agent="codex", spawn=_successful_spawn
    )

    assert {state.task_id for state in launched} == {str(b.id)}
    assert len(_successful_spawn.calls) == 1
    assert _successful_spawn.calls[0]["task_id"] == str(b.id)


def test_generate_leaf_llds_isolates_launch_failure_per_leaf(task):
    todo = _make_todo_state(task.project)
    a = _leaf(task, todo, seq=10, name="Alpha")
    b = _leaf(task, todo, seq=11, name="Bravo")

    async def _spawn_fail_a(**kwargs):
        if kwargs["task_id"] == str(a.id):
            raise RuntimeError("tmux unavailable")
        return "run-ok"

    launched = driver.generate_leaf_llds(
        str(task.id), agent="codex", spawn=_spawn_fail_a
    )

    by_task = {state.task_id: state for state in launched}
    assert by_task[str(a.id)].status == "failed"
    assert "tmux unavailable" in by_task[str(a.id)].error
    assert by_task[str(b.id)].status == "running"
    assert by_task[str(b.id)].agent_run_id == "run-ok"


def test_generate_leaf_llds_rejects_missing_root():
    with pytest.raises(ValueError, match="task_not_found"):
        driver.generate_leaf_llds(
            str(uuid.uuid4()), agent="codex", spawn=_successful_spawn
        )


def test_execute_lld_rejects_non_todo_task(task):
    _successful_spawn.calls.clear()

    with pytest.raises(ValueError, match="task_not_in_todo"):
        driver.execute(str(task.id), agent="codex", phase="lld", spawn=_successful_spawn)

    assert _successful_spawn.calls == []


def test_observe_issue_state_changed_refine_requires_backlog_to_unstarted(task):
    state = driver.execute(
        str(task.id),
        agent="codex",
        phase="refine",
        spawn=_successful_spawn,
    )
    assert state.status == "running"

    bounce = driver.observe_issue_state_changed(
        issue_id=str(task.id),
        from_group="started",
        to_group="unstarted",
    )
    assert bounce == state

    todo = State.objects.create(
        id=uuid.uuid4(),
        project=task.project,
        name="Todo",
        group="unstarted",
    )
    task.state = todo
    task.lifecycle_state = "prd_review"
    task.save(update_fields=["state", "lifecycle_state"])
    observed = driver.observe_issue_state_changed(
        issue_id=str(task.id),
        from_group="backlog",
        to_group="unstarted",
    )

    assert observed.status == "done"
    task.refresh_from_db()
    assert task.lifecycle_state == "prd_approved"
    assert driver.get_state(str(task.id)).status == "done"


def test_release_running_run_returns_previous_and_clears_registry(task):
    _successful_spawn.calls.clear()
    state = driver.execute(
        str(task.id), agent="codex", phase="refine", spawn=_successful_spawn
    )
    assert state.status == "running"

    released = driver.release(str(task.id))

    assert released.status == "running"
    assert released.task_id == str(task.id)
    assert released.agent_run_id == "run-1"
    assert released.phase == "refine"
    assert driver.get_state(str(task.id)) is None


def test_release_no_registered_run_raises(task):
    with pytest.raises(ValueError, match="planning_run_not_found"):
        driver.release(str(task.id))


def test_release_non_running_run_raises(task):
    # A launch failure leaves a registered but non-running (failed) state; it is
    # not a releasable lock.
    state = driver.execute(str(task.id), agent="codex", spawn=_failing_spawn)
    assert state.status == "failed"

    with pytest.raises(ValueError, match="planning_run_not_found"):
        driver.release(str(task.id))


def test_release_then_relaunch_is_a_fresh_launch(task):
    _successful_spawn.calls.clear()
    driver.execute(
        str(task.id), agent="codex", phase="refine", spawn=_successful_spawn
    )
    driver.release(str(task.id))

    relaunched = driver.execute(
        str(task.id), agent="claude", phase="refine", spawn=_successful_spawn
    )

    assert relaunched.status == "running"
    assert relaunched.agent == "claude"
    assert len(_successful_spawn.calls) == 2
