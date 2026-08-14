"""Audit timestamps on WorkTracker work-item responses."""

import uuid

import pytest

from worktracker.models import IssueType
from worktracker.tests.conftest import BASE, post_json


def _task(client, project, auth, name):
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Task",
        level="task",
    )
    response = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": name, "issue_type_id": str(issue_type.id)},
        auth,
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.django_db
def test_work_item_out_exposes_timestamps(client, project, auth):
    task = _task(client, project, auth, "A")
    assert task["created_at"] and task["updated_at"]

    response = client.get(f"{BASE}/work-items/{task['id']}", headers=auth)
    detail = response.json()
    assert detail["created_at"] and detail["updated_at"]
