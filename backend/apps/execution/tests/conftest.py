"""Execution-app test guards and the shared graph-run scenario fixtures.

These tests run with ``transaction=True``, so the worktracker
``issue_state_changed`` seam really fires on every ``Issue.save()`` — and the
driver's launch path defaults to the real ``spawn_run``, which starts a real
tmux session. Block it for every test in this app; tests inject their own
spawn stubs explicitly.

``graph_project``, ``clean_registry``, and ``detach_seam_receiver`` serve the
scheduling suites. They are not autouse: a suite opts in with
``pytest.mark.usefixtures`` so the other suites keep the live signal receiver.
"""

from __future__ import annotations

import uuid

import pytest

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask
from apps.execution.signals import observe_completion
from worktracker.models import (
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    State,
)
from worktracker.signals import issue_state_changed


@pytest.fixture(autouse=True)
def _block_real_spawn(monkeypatch):
    async def _blocked(**kwargs):
        raise RuntimeError("real spawn_run blocked in execution tests")

    monkeypatch.setattr(driver, "spawn_run", _blocked)


@pytest.fixture(autouse=True)
def _no_background_reconciliation(monkeypatch):
    """Keep the best-effort liveness sweep out of these tests.

    The real request submits ``reconcile_terminals`` to a background thread,
    which both races the test's own writes on SQLite's shared-cache test
    database ("database table is locked") and can terminate the very fake
    sessions a scenario is holding live. The refresh is best-effort by
    contract; its own behavior is pinned by ``test_serial_liveness_refresh``,
    which installs its own recorder over this stub.
    """

    monkeypatch.setattr(driver, "request_terminal_liveness_refresh", lambda: False)


def _clear_registry():
    LaunchedTask.objects.all().delete()
    GraphRun.objects.all().delete()


@pytest.fixture
def clean_registry():
    _clear_registry()
    yield
    _clear_registry()


@pytest.fixture
def detach_seam_receiver():
    issue_state_changed.disconnect(dispatch_uid="execution_observe_issue_state_changed")
    yield
    issue_state_changed.connect(
        observe_completion,
        dispatch_uid="execution_observe_issue_state_changed",
    )


@pytest.fixture
def graph_project():
    """One project, module, armable root, and the states satisfaction reads."""

    project = Project.objects.create(id=uuid.uuid4(), name="meml", slug="MEML")
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
