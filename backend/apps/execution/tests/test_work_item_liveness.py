"""The one per-work-item liveness rule, exercised where it now lives."""

from __future__ import annotations

import uuid

import pytest

from apps.execution.work_item_liveness import has_live_work, live_work_item_ids
from apps.runs.models import AgentRun
from apps.terminals.models import AgentTerminalSession
from worktracker.models import Issue, IssueType, Project, Workspace


pytestmark = pytest.mark.django_db


@pytest.fixture
def project():
    slug = f"liveness-{uuid.uuid4().hex[:8]}"
    workspace = Workspace.objects.create(id=uuid.uuid4(), slug=slug, name=slug)
    return Project.objects.create(
        id=uuid.uuid4(), workspace=workspace, name=slug, slug=slug.upper()
    )


@pytest.fixture
def task_type(project):
    return IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )


def _task(project, task_type, sequence_id: int) -> Issue:
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        name=f"Task {sequence_id}",
        sequence_id=sequence_id,
    )


def _run(issue, run_id: str, *, active: bool) -> AgentRun:
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


def _session(run, issue, *, terminated: bool = False) -> AgentTerminalSession:
    return AgentTerminalSession.objects.create(
        agent_run=run,
        tmux_session_name=str(run.id),
        task_id=str(issue.id),
        module_id=str(uuid.uuid4()),
        project_id=str(issue.project_id),
        agent="codex",
        created_at="2026-08-08T10:00:00+00:00",
        terminated_at="2026-08-08T10:05:00+00:00" if terminated else None,
        scope="task",
    )


def test_a_live_run_or_a_live_terminal_makes_a_work_item_live(project, task_type):
    by_run = _task(project, task_type, 1)
    by_terminal = _task(project, task_type, 2)
    quiet = _task(project, task_type, 3)
    _run(by_run, "run-live", active=True)
    # An ended run whose terminal has not been reaped is still live work.
    _session(_run(by_terminal, "run-ended-live-terminal", active=False), by_terminal)
    _session(_run(quiet, "run-quiet", active=False), quiet, terminated=True)

    assert live_work_item_ids([by_run.id, by_terminal.id, quiet.id]) == {
        str(by_run.id),
        str(by_terminal.id),
    }
    assert has_live_work(by_run.id) is True
    assert has_live_work(quiet.id) is False


def test_the_excluded_run_does_not_count_as_itself_or_through_its_terminal(
    project, task_type
):
    task = _task(project, task_type, 1)
    _session(_run(task, "run-caller", active=True), task)

    assert has_live_work(task.id) is True
    assert has_live_work(task.id, exclude_agent_run_id="run-caller") is False
    assert live_work_item_ids([task.id], exclude_agent_run_id="run-caller") == set()


def test_another_live_run_survives_the_exclusion(project, task_type):
    task = _task(project, task_type, 1)
    _run(task, "run-caller", active=True)
    _run(task, "run-other", active=True)

    assert has_live_work(task.id, exclude_agent_run_id="run-caller") is True


def test_another_live_terminal_survives_the_exclusion(project, task_type):
    task = _task(project, task_type, 1)
    _run(task, "run-caller", active=True)
    _session(_run(task, "run-other", active=False), task)

    assert has_live_work(task.id, exclude_agent_run_id="run-caller") is True


def test_no_ids_asks_nothing_of_either_store(project, task_type):
    assert live_work_item_ids([]) == set()
