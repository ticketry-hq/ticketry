import uuid

import pytest

from worktracker.models import Issue, IssueType


def _issue(project, type, sequence_id, parent=None, name="x"):
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name=f"Test {type}",
        defaults={"id": uuid.uuid4(), "level": type},
    )
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type=type,
        issue_type=issue_type,
        name=name,
        sequence_id=sequence_id,
        parent=parent,
    )


@pytest.mark.django_db
def test_issue_tree_module_task_subtask(project):
    """module -> task(parent=module) -> subtask(parent=task) resolve via children (C1)."""

    module = _issue(project, "module", 1)
    task = _issue(project, "task", 2, parent=module)
    subtask = _issue(project, "task", 3, parent=task)

    assert list(module.children.all()) == [task]
    assert list(task.children.all()) == [subtask]
    assert subtask.parent.parent == module


@pytest.mark.django_db
def test_uuid_pk_accepts_supplied_uuid(project, task_type):
    """A create with an explicit uuid reads back unchanged (C10-ready)."""

    supplied = uuid.uuid4()
    Issue.objects.create(
        id=supplied,
        project=project,
        type="task",
        issue_type=task_type,
        name="x",
        sequence_id=7,
    )

    assert Issue.objects.get(pk=supplied).id == supplied


@pytest.mark.django_db
def test_key_is_identifier_dash_seq(project):
    """The key is ``{project.slug}-{sequence_id}`` (C1)."""

    issue = _issue(project, "task", 7)

    assert issue.key == "MEML-7"
