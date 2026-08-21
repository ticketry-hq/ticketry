"""Failure isolation for the work-item-state status-feed adapter."""

import uuid

import pytest

from worktracker.models import Issue, IssueType, Project, State


pytestmark = pytest.mark.django_db(transaction=True)


def test_publication_failure_does_not_undo_committed_transition(monkeypatch) -> None:
    project = Project.objects.create(id=uuid.uuid4(), name="Publish failure", slug="FAIL")
    before = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    after = State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Task", level="task"
    )
    issue = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name="Item",
        sequence_id=1,
        state=before,
    )

    async def fail_publish(*args, **kwargs):
        raise RuntimeError("channel layer unavailable")

    monkeypatch.setattr("apps.runs.signals.publish_status", fail_publish)
    issue.state = after
    issue.save()

    issue.refresh_from_db()
    assert issue.state_id == after.id
