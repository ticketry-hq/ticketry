from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone
from worktracker.models import Issue, IssueType, Project

from apps.source_control.models import (
    CHECKOUT_BASE,
    CHECKOUT_WORKTREE,
    PR_OPEN,
    STEP_DONE,
    STEP_FAILED,
    STEP_SKIPPED,
    ShipRecord,
)
from apps.source_control.tests.conftest import MODULE_ID, PROJECT_ID, TASK_ID

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def disable_api_auth(settings):
    settings.WORKTRACKER_DISABLE_AUTH = True


def _record(*, module_id=MODULE_ID, task_id=TASK_ID, action_at=None, **overrides):
    values = {
        "action_id": uuid.uuid4(),
        "module_id": module_id,
        "task_id": task_id,
        "checkout_kind": CHECKOUT_WORKTREE if task_id else CHECKOUT_BASE,
        "checkout_name": "CODING-1046 checkout" if task_id else "Base checkout",
        "branch": "wt/CODING-1046" if task_id else "main",
        "commit_shas": ["a" * 40],
        "commit_outcome": {"status": STEP_DONE},
        "push_outcome": {"status": STEP_FAILED, "message": "Push was rejected."},
        "create_pr_outcome": {"status": STEP_SKIPPED},
        "action_at": action_at or timezone.now(),
    }
    values.update(overrides)
    return ShipRecord.objects.create(**values)


def _other_project_module_and_task():
    project = Project.objects.create(
        id=uuid.uuid4(), name="Other project", slug="OTHER"
    )
    module_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Module", level="module"
    )
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Other module",
        sequence_id=1,
    )
    task = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=task_type,
        parent=module,
        module=module,
        name="Other task",
        sequence_id=2,
    )
    return project, module, task


def _url(project_id=PROJECT_ID, module_id=MODULE_ID):
    return f"/api/work-tracker/projects/{project_id}/modules/{module_id}/ship-records"


def test_module_ship_records_are_serialized_newest_first_and_strictly_scoped(client):
    now = timezone.now()
    older = _record(action_at=now - timedelta(minutes=5))
    newer = _record(
        task_id=None,
        action_at=now,
        pr_url="https://github.com/ticketry-hq/ticketry/pull/42",
        pr_number=42,
        pr_state=PR_OPEN,
    )
    other_project, other_module, other_task = _other_project_module_and_task()
    foreign = _record(
        module_id=other_module.id,
        task_id=other_task.id,
        action_at=now + timedelta(minutes=5),
    )

    response = client.get(_url())

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body] == [str(newer.id), str(older.id)]
    assert str(foreign.id) not in {row["id"] for row in body}
    assert body[0]["checkout_kind"] == CHECKOUT_BASE
    assert body[0]["task_id"] is None
    assert body[0]["pr_url"].endswith("/pull/42")
    assert body[1]["push_outcome"] == {
        "status": STEP_FAILED,
        "message": "Push was rejected.",
    }

    wrong_project = client.get(_url(other_project.id, MODULE_ID))
    wrong_module = client.get(_url(PROJECT_ID, other_module.id))
    assert wrong_project.status_code == 200
    assert wrong_project.json() == []
    assert wrong_module.status_code == 200
    assert wrong_module.json() == []


def test_module_ship_records_use_default_api_key_authentication(client, settings):
    settings.WORKTRACKER_DISABLE_AUTH = False
    settings.WORKTRACKER_API_TOKEN = "ship-history-secret"

    rejected = client.get(_url())
    accepted = client.get(_url(), HTTP_X_API_KEY="ship-history-secret")

    assert rejected.status_code == 401
    assert accepted.status_code == 200
