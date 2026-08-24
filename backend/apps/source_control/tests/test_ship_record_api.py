from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.test import Client
from django.utils import timezone

from apps.source_control.models import (
    CHECKOUT_BASE,
    CHECKOUT_WORKTREE,
    PR_OPEN,
    STEP_DONE,
    STEP_SKIPPED,
    ShipRecord,
)
from apps.source_control.tests.conftest import MODULE_ID, PROJECT_ID, TASK_ID
from worktracker.models import Issue, IssueType, Project


pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


def _outcome(status=STEP_DONE):
    return {"status": status}


def _record(*, action_at, task_id=TASK_ID, module_id=MODULE_ID, pr_number=None):
    has_pr = pr_number is not None
    return ShipRecord.objects.create(
        action_id=uuid.uuid4(),
        module_id=module_id,
        task_id=task_id,
        checkout_kind=CHECKOUT_WORKTREE if task_id else CHECKOUT_BASE,
        checkout_name="Task worktree" if task_id else "Base checkout",
        branch="CODIN-1045-task-ship-line",
        commit_shas=["a" * 40],
        commit_outcome=_outcome(),
        push_outcome=_outcome(),
        create_pr_outcome=_outcome() if has_pr else _outcome(STEP_SKIPPED),
        pr_url=(
            f"https://github.com/ticketry-hq/ticketry/pull/{pr_number}"
            if has_pr
            else None
        ),
        pr_number=pr_number,
        pr_state=PR_OPEN if has_pr else None,
        action_at=action_at,
    )


def _task(*, project, module, name):
    task_type = IssueType.objects.get(project=project, level="task")
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        parent=module,
        module=module,
        name=name,
        sequence_id=100,
    )


def _url(project_id=PROJECT_ID, task_id=TASK_ID):
    return (
        f"/api/work-tracker/projects/{project_id}/work-items/"
        f"{task_id}/ship-records"
    )


def test_task_ship_records_are_serialized_newest_first_without_scope_leakage():
    now = timezone.now()
    module = Issue.objects.get(pk=MODULE_ID)
    project = module.project
    other_task = _task(project=project, module=module, name="Other task")

    older = _record(action_at=now - timedelta(hours=2), pr_number=42)
    newer = _record(action_at=now - timedelta(hours=1))
    _record(action_at=now, task_id=other_task.id)
    _record(action_at=now + timedelta(hours=1), task_id=None)

    response = Client().get(_url())

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(newer.id), str(older.id)]
    assert response.json()[1]["pr_number"] == 42
    assert response.json()[1]["task_id"] == TASK_ID


def test_task_ship_records_reject_foreign_project_and_module_ids():
    project = Project.objects.get(pk=PROJECT_ID)
    module = Issue.objects.get(pk=MODULE_ID)
    foreign_project = Project.objects.create(
        id=uuid.uuid4(), name="Foreign project", slug="FOREIGN"
    )

    foreign_response = Client().get(_url(project_id=foreign_project.id))
    module_response = Client().get(_url(task_id=module.id))

    assert foreign_response.status_code == 404
    assert module_response.status_code == 404


def test_archived_task_keeps_its_ship_history_readable():
    task = Issue.objects.get(pk=TASK_ID)
    task.is_archived = True
    task.save(update_fields=("is_archived",))
    record = _record(action_at=timezone.now(), pr_number=51)

    response = Client().get(_url())

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(record.id)]
