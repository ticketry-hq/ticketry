"""Durable project-monotonic WorkItem change revisions."""

import uuid

import pytest
from django.db import transaction

from worktracker.models import Issue, IssueType, State
from worktracker.tests.conftest import BASE


pytestmark = pytest.mark.django_db


@pytest.fixture
def states(project):
    return [
        State.objects.create(id=uuid.uuid4(), project=project, name=name, group=group)
        for name, group in (("Todo", "unstarted"), ("Doing", "started"))
    ]


def _issue(project, sequence_id):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        name=f"Item {sequence_id}",
        sequence_id=sequence_id,
        issue_type=issue_type,
    )


def test_committed_transitions_receive_project_monotonic_revisions(project, states):
    first = _issue(project, 1)
    second = _issue(project, 2)

    first.state = states[0]
    first.save(update_fields=["state", "updated_at"])
    second.state = states[1]
    second.save(update_fields=["state", "updated_at"])

    project.refresh_from_db()
    first.refresh_from_db()
    second.refresh_from_db()

    assert project.state_revision == 4
    assert first.state_revision == 3
    assert second.state_revision == 4


def test_no_op_and_rollback_do_not_advance_revision(project, states):
    issue = _issue(project, 1)
    issue.state = states[0]
    issue.save(update_fields=["state", "updated_at"])

    issue.save(update_fields=["state", "updated_at"])
    project.refresh_from_db()
    issue.refresh_from_db()
    assert project.state_revision == 2
    assert issue.state_revision == 2

    with pytest.raises(RuntimeError):
        with transaction.atomic():
            issue.state = states[1]
            issue.save(update_fields=["state", "updated_at"])
            raise RuntimeError("force rollback")

    project.refresh_from_db()
    issue.refresh_from_db()
    assert project.state_revision == 2
    assert issue.state_revision == 2
    assert issue.state_id == states[0].id


def test_full_and_targeted_work_item_reads_expose_state_revision(
    client, project, states, auth
):
    issue = _issue(project, 1)
    issue.state = states[0]
    issue.save(update_fields=["state", "updated_at"])

    full = client.get(f"{BASE}/work-items?project={project.id}", headers=auth).json()
    targeted = client.get(f"{BASE}/work-items/{issue.id}", headers=auth).json()

    assert full[0]["state_revision"] == 2
    assert targeted["state_revision"] == 2
