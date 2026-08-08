"""Auto-integrate-on-Done close-hook tests (Worktrees W3, #589).

Exercise the real ``post_save`` receiver on the worktracker ``Issue`` model.
``service.integrate`` is stubbed (the hook's contract is *that it dispatches*,
not git mechanics — those are covered by the W1 engine tests), and the
off-thread executor is made synchronous so assertions are deterministic.
"""

from __future__ import annotations

import uuid
from unittest.mock import Mock

import pytest

from worktracker.models import Issue, IssueType, Project, State, Workspace
from apps.worktrees import service, signals
from apps.worktrees.models import Worktree


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def sync_executor(monkeypatch):
    """Run the integrate dispatch inline so the test can observe it."""

    monkeypatch.setattr(signals, "integrate_executor", lambda fn: fn())


@pytest.fixture
def project():
    ws = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    project = Project.objects.create(
        id=uuid.uuid4(), workspace=ws, name="Coding", slug="CODIN", seq_counter=10
    )
    IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    return project


def _state(project, group: str) -> State:
    return State.objects.create(
        id=uuid.uuid4(), project=project, name=group.title(), group=group
    )


def _task(project, *, seq: int, state: State) -> Issue:
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="A task",
        sequence_id=seq,
        state=state,
        issue_type=IssueType.objects.get(project=project, level="task"),
    )


def _seed_worktree(task_id: str) -> None:
    Worktree.objects.create_for_task(
        task_id=task_id,
        repo_root="/repo",
        path="/repo/wt",
        branch="wt/CODIN-1-a",
        base_branch="main",
        base_commit="deadbeef",
    )


def test_close_hook_integrates(project, monkeypatch):
    """Completing a task that owns a worktree dispatches integrate(task_id)."""

    integrate = Mock(return_value=service.IntegrateResult("x", "integrated"))
    monkeypatch.setattr(service, "integrate", integrate)

    started = _state(project, "started")
    completed = _state(project, "completed")
    task = _task(project, seq=1, state=started)
    _seed_worktree(str(task.id))

    integrate.assert_not_called()  # created in 'started' → no land yet

    task.state = completed
    task.save()

    integrate.assert_called_once_with(str(task.id))


def test_close_hook_no_worktree_noop(project, monkeypatch):
    """Completing a task with no worktree record never calls integrate."""

    integrate = Mock()
    monkeypatch.setattr(service, "integrate", integrate)

    completed = _state(project, "completed")
    _task(project, seq=2, state=completed)  # save into completed, no record

    integrate.assert_not_called()


def test_close_hook_subtask_does_not_land_parent(project, monkeypatch):
    """Completing a sub-task does not land the parent's worktree."""

    integrate = Mock()
    monkeypatch.setattr(service, "integrate", integrate)

    completed = _state(project, "completed")
    parent = _task(project, seq=3, state=_state(project, "started"))
    _seed_worktree(str(parent.id))

    sub = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name="sub",
        sequence_id=4,
        state=completed,
        parent=parent,
        issue_type=parent.issue_type,
    )

    # Only the sub-task entered completed; its own id owns no worktree.
    integrate.assert_not_called()
    assert Worktree.objects.get_by_task(str(sub.id)) is None


def test_close_hook_cancelled_leaves(project, monkeypatch):
    """Entering the cancelled group does not integrate or discard."""

    integrate = Mock()
    discard = Mock()
    monkeypatch.setattr(service, "integrate", integrate)
    monkeypatch.setattr(service, "discard", discard)

    cancelled = _state(project, "cancelled")
    task = _task(project, seq=5, state=_state(project, "started"))
    _seed_worktree(str(task.id))

    task.state = cancelled
    task.save()

    integrate.assert_not_called()
    discard.assert_not_called()
    assert Worktree.objects.get_by_task(str(task.id)) is not None
