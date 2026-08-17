"""Graph-run execution-mode contract over the HTTP resource (CODING-462).

Only the durable mode contract lives here: which mode a request selects, what
an omitted or invalid mode does, and whether the campaign's stored mode
survives revival and reset. Scheduling behaviour itself is covered by the
execution driver's graph tests.
"""

from __future__ import annotations

import importlib
import uuid

import pytest
from django.test import Client, override_settings

from apps.execution import driver
from apps.execution.models import GraphRun, LaunchedTask
from apps.runs.models import AgentRun
from worktracker.models import (
    Issue,
    IssueType,
    LaunchBinding,
    Project,
    State,
    Workspace,
)


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def clean_registry():
    LaunchedTask.objects.all().delete()
    GraphRun.objects.all().delete()
    yield
    LaunchedTask.objects.all().delete()
    GraphRun.objects.all().delete()


@pytest.fixture
def client():
    return Client()


@pytest.fixture
def project():
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug="meml", name="meml")
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name="meml", slug="MEML"
    )


def _issue_type(project, name, level):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name=name,
        defaults={"id": uuid.uuid4(), "level": level},
    )
    return issue_type


@pytest.fixture
def module(project):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=_issue_type(project, "Module", "module"),
        name="Module",
        sequence_id=1,
    )


@pytest.fixture
def todo(project):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )


@pytest.fixture
def root(project, module, todo):
    issue_type = _issue_type(project, "Story", "task")
    LaunchBinding.objects.get_or_create(
        issue_type=issue_type,
        state=todo,
        defaults={"subtree_run_enabled": True},
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        parent=module,
        state=todo,
        name="Root",
        sequence_id=2,
    )


@pytest.fixture
def child(project, root, todo):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=_issue_type(project, "Story", "task"),
        parent=root,
        state=todo,
        name="Child",
        sequence_id=3,
    )


@pytest.fixture
def spawn(monkeypatch):
    calls: list[dict] = []

    async def _spawn(**kwargs):
        calls.append(kwargs)
        return f"run-{len(calls)}"

    monkeypatch.setattr(driver, "spawn_run", _spawn)
    return calls


def _post(client, root, body):
    return client.post(
        f"/api/work-tracker/work-items/{root.id}/graph-run",
        data=body,
        content_type="application/json",
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


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_explicit_serial_mode_is_persisted_on_the_graph_run(
    client, root, child, spawn
):
    response = _post(client, root, {"agent": "codex", "mode": "serial"})

    assert response.status_code == 201
    assert response.json() == {"root_id": str(root.id), "launched": [str(child.id)]}
    assert GraphRun.objects.get(root=root).execution_mode == "serial"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize(
    "body",
    [{}, {"agent": "codex"}, {"agent": "codex", "mode": "parallel"}],
    ids=["empty-body", "omitted-mode", "explicit-parallel"],
)
def test_omitted_mode_keeps_existing_parallel_callers(client, root, child, spawn, body):
    response = _post(client, root, body)

    assert response.status_code == 201
    assert response.json()["launched"] == [str(child.id)]
    assert GraphRun.objects.get(root=root).execution_mode == "parallel"


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
@pytest.mark.parametrize("mode", ["sequential", "SERIAL", 7, True])
def test_invalid_mode_is_refused_with_a_structured_error(
    client, root, child, spawn, mode
):
    response = _post(client, root, {"agent": "codex", "mode": mode})

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_execution_mode"
    assert response.json()["detail"] == "invalid_execution_mode"
    assert not GraphRun.objects.filter(root=root).exists()
    assert spawn == []


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_pressing_again_on_an_ended_campaign_refreshes_its_stored_mode(
    client, root, child, spawn
):
    armed = _post(client, root, {"agent": "codex"})
    _agent_run(child, "run-1", active=False)

    pressed_again = _post(client, root, {"agent": "codex", "mode": "serial"})

    assert armed.status_code == 201
    assert GraphRun.objects.get(root=root).execution_mode == "serial"
    assert pressed_again.status_code == 201
    assert pressed_again.json()["launched"] == [str(child.id)]


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_a_live_campaign_accepts_a_repeat_request_and_refreshes_its_mode(
    client, root, child, spawn
):
    """A healthy campaign is not disturbed, but the press is not a conflict.

    Its one child is live, so nothing starts; the request still succeeds and
    the stored mode follows the button that was pressed.
    """

    armed = _post(client, root, {"agent": "codex", "mode": "serial"})
    _agent_run(child, "run-1", active=True)

    repeated = _post(client, root, {"agent": "codex", "mode": "parallel"})

    assert armed.status_code == 201
    assert repeated.status_code == 201
    assert repeated.json() == {"root_id": str(root.id), "launched": []}
    assert GraphRun.objects.get(root=root).execution_mode == "parallel"
    assert len(spawn) == 1


@override_settings(WORKTRACKER_DISABLE_AUTH=True)
def test_reset_clears_a_serial_campaign_and_a_later_request_re_arms_it(
    client, root, child, spawn
):
    _post(client, root, {"agent": "codex", "mode": "serial"})

    reset = client.delete(f"/api/work-tracker/work-items/{root.id}/graph-run")
    re_armed = _post(client, root, {"agent": "codex"})

    assert reset.status_code == 200
    assert reset.json() == {"root_id": str(root.id), "cleared": [str(child.id)]}
    assert re_armed.status_code == 201
    assert GraphRun.objects.get(root=root).execution_mode == "parallel"


def test_a_header_written_without_a_mode_reads_back_as_parallel(project, module, root):
    """Rows that predate the mode column keep the historical behaviour."""

    header = GraphRun.objects.create(
        root_id=root.id,
        project_id=project.id,
        module_id=module.id,
        agent=None,
    )

    header.refresh_from_db()
    assert header.execution_mode == "parallel"


def test_the_migration_backfills_existing_rows_with_parallel():
    migration = importlib.import_module(
        "apps.execution.migrations.0006_graphrun_execution_mode"
    )
    (added,) = migration.Migration.operations

    assert (added.model_name, added.name) == ("graphrun", "execution_mode")
    assert added.field.default == "parallel"
    assert [value for value, _ in added.field.choices] == ["parallel", "serial"]
