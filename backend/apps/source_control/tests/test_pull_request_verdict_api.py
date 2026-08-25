"""REST coverage for the Changes tab's lazy pull-request verdict (#1035).

Every case uses a real temporary repository and task worktree. The only fake is
``gh`` itself, installed as an executable on the isolated PATH and invoked by
the production process boundary.
"""

from __future__ import annotations

import shutil
import uuid

import pytest
from django.test import Client
from django.utils import timezone
from worktracker.models import Issue, IssueType, Project

from apps.source_control.clients.gh_cli import APPROVED_PATH_ENV
from apps.source_control.models import (
    CHECKOUT_WORKTREE,
    PR_CLOSED,
    PR_MERGED,
    PR_OPEN,
    STEP_DONE,
    ShipRecord,
)
from apps.source_control.tests.commit_fixtures import isolate_generators
from apps.source_control.tests.pull_request_fixtures import install_gh, recorded_argv
from apps.worktrees import service as worktrees_service

pytestmark = [
    pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(shutil.which("git") is None, reason="git not on PATH"),
]

PR_URL = "https://github.com/ticketry-hq/ticketry/pull/42"


class HostClient(Client):
    def get(self, path, *args, **kwargs):
        return super().get(f"/api{path}", *args, **kwargs)


client = HostClient()


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


@pytest.fixture(autouse=True)
def bin_dir(monkeypatch, tmp_path):
    monkeypatch.delenv(APPROVED_PATH_ENV, raising=False)
    return isolate_generators(monkeypatch, tmp_path)


@pytest.fixture
def gh_logs(tmp_path):
    return tmp_path / "gh-logs"


@pytest.fixture
def task_with_worktree(repo):
    """A top-level task under a module, with a real worktree of ``repo``.

    The task's parent is the module itself, so the task *is* the worktree
    anchor a ship record is allowed to own.
    """

    project = Project.objects.create(
        id=uuid.uuid4(), name="Pull request verdicts", slug="PRV"
    )
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
        name="Studio",
        sequence_id=1,
    )
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=story_type,
        name="Show the verdict",
        sequence_id=2,
        parent=module,
        module=module,
    )
    result = worktrees_service.create(
        task_id=str(task.id),
        working_path=str(repo),
        task_name=task.name,
        ticket_seq=task.sequence_id,
        module_id=str(module.id),
    )
    assert not isinstance(result, worktrees_service.NoWorktree)
    return task


def ship(task, *, state=PR_OPEN):
    """One PR-bearing ship record anchored to the task's worktree."""

    return ShipRecord.objects.create(
        action_id=uuid.uuid4(),
        module_id=task.module_id,
        task_id=task.id,
        checkout_kind=CHECKOUT_WORKTREE,
        checkout_name="CODING-1035 checkout",
        branch="wt/CODING-1035",
        commit_shas=["a" * 40],
        commit_outcome={"status": STEP_DONE},
        push_outcome={"status": STEP_DONE},
        create_pr_outcome={"status": STEP_DONE},
        pr_url=PR_URL,
        pr_number=42,
        pr_state=state,
        action_at=timezone.now(),
    )


def read_changes(task) -> dict:
    response = client.get(
        f"/worktrees/changes?task_id={task.id}&module_id={task.module_id}"
    )
    assert response.status_code == 200, response.content
    return response.json()


def test_merged_verdict_is_persisted_and_later_reads_skip_gh(
    task_with_worktree, bin_dir, gh_logs
):
    record = ship(task_with_worktree)
    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"OPEN","mergedAt":"2026-08-24T12:00:00Z"}',
    )

    first = read_changes(task_with_worktree)
    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"OPEN","mergedAt":null}',
    )
    second = read_changes(task_with_worktree)

    expected = {"url": PR_URL, "number": 42, "state": "MERGED"}
    assert first["pull_request"] == expected
    assert second["pull_request"] == expected
    assert recorded_argv(gh_logs) == [f"pr view {PR_URL} --json state,mergedAt"]

    record.refresh_from_db()
    assert record.pr_state == PR_MERGED
    assert record.pr_refreshed_at is not None


def test_open_verdict_is_checked_again_on_every_read(
    task_with_worktree, bin_dir, gh_logs
):
    record = ship(task_with_worktree)
    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"OPEN","mergedAt":null}',
    )

    assert read_changes(task_with_worktree)["pull_request"]["state"] == "OPEN"
    record.refresh_from_db()
    assert record.pr_state == PR_OPEN
    assert record.pr_refreshed_at is None

    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"MERGED","mergedAt":"2026-08-24T12:00:00Z"}',
    )
    assert read_changes(task_with_worktree)["pull_request"]["state"] == "MERGED"
    assert recorded_argv(gh_logs) == [
        f"pr view {PR_URL} --json state,mergedAt",
        f"pr view {PR_URL} --json state,mergedAt",
    ]


def test_closed_verdict_is_terminal(task_with_worktree, bin_dir, gh_logs):
    record = ship(task_with_worktree)
    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"CLOSED","mergedAt":null}',
    )

    first = read_changes(task_with_worktree)
    install_gh(
        bin_dir,
        gh_logs,
        view_prints='{"state":"OPEN","mergedAt":null}',
    )
    second = read_changes(task_with_worktree)

    assert first["pull_request"]["state"] == "CLOSED"
    assert second["pull_request"]["state"] == "CLOSED"
    assert len(recorded_argv(gh_logs)) == 1

    record.refresh_from_db()
    assert record.pr_state == PR_CLOSED


def test_shipless_task_and_provider_failures_leave_changes_readable(
    task_with_worktree, bin_dir, gh_logs
):
    shipless = read_changes(task_with_worktree)
    assert shipless["kind"] == "changes"
    assert shipless["pull_request"] is None

    ship(task_with_worktree)
    unavailable = read_changes(task_with_worktree)
    assert unavailable["kind"] == "changes"
    assert unavailable["pull_request"] is None

    install_gh(bin_dir, gh_logs)
    refused = read_changes(task_with_worktree)
    assert refused["kind"] == "changes"
    assert refused["pull_request"] is None
