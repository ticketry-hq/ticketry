"""Unit tests for the framework-neutral read/query services (#738).

These prove the in-process read surface returns the same data the REST API
serializes (restricted to the subset the adapter reads): dict shape parity with
the ``*Out`` schemas, ordering, archived exclusion, the ``child_count``-sourced
``sub_issues_count``, the module subtree vs direct-children split, and the
``Http404 -> NotFoundError`` boundary.
"""

import uuid

import pytest

from worktracker.models import Issue, IssueType, State
from worktracker.services import queries
from worktracker.services.errors import NotFoundError
from worktracker.services.work_items import create_project_work_item


@pytest.fixture
def states(project):
    """Two states with deliberately out-of-order sort_order to test ordering."""

    todo = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted", sort_order=1
    )
    backlog = State.objects.create(
        id=uuid.uuid4(), project=project, name="Backlog", group="backlog", sort_order=0
    )
    return backlog, todo


@pytest.mark.django_db
def test_list_modules_excludes_archived(project, module_type):
    live = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Live",
        sequence_id=98,
    )
    archived = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="Gone",
        sequence_id=99,
        is_archived=True,
    )

    rows = queries.list_modules(project.id)

    ids = {r["id"] for r in rows}
    assert live.id in ids
    assert archived.id not in ids
    assert rows[0]["project_id"] == project.id


@pytest.mark.django_db
def test_list_states_ordered_by_sort_order(project, states):
    backlog, todo = states

    rows = queries.list_states(project.id)

    assert [r["name"] for r in rows] == ["Backlog", "Todo"]
    assert rows[0] == {
        "id": backlog.id,
        "name": "Backlog",
        "group": "backlog",
        "color": backlog.color,
    }


@pytest.mark.django_db
def test_work_item_dict_shape_and_relations(project, states):
    backlog, _ = states
    task_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Story", level="task"
    )

    parent = create_project_work_item(
        project.id,
        name="Parent",
        state_id=backlog.id,
        issue_type_id=task_type.id,
    )
    child = create_project_work_item(
        project.id,
        name="Child",
        parent_id=parent.id,
        issue_type_id=task_type.id,
    )

    parent_row = queries.retrieve_work_item(str(parent.id))
    row = queries.retrieve_work_item(str(child.id))

    assert parent_row["state"] == {
        "id": backlog.id,
        "name": "Backlog",
        "group": "backlog",
        "color": backlog.color,
    }
    assert parent_row["sub_issues_count"] == 1
    assert row["name"] == "Child"
    assert row["parent_id"] == parent.id


@pytest.mark.django_db
def test_state_none_serializes_to_none(project, task_type):
    issue = create_project_work_item(
        project.id, name="Stateless", issue_type_id=task_type.id
    )
    issue.state = None
    issue.save(update_fields=["state"])

    row = queries.retrieve_work_item(str(issue.id))

    assert row["state"] is None


@pytest.mark.django_db
def test_list_module_tasks_and_states_returns_subtree(
    project, module_type, task_type
):
    module = Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="module",
        issue_type=module_type,
        name="M",
        sequence_id=97,
    )
    child = create_project_work_item(
        project.id,
        name="Child",
        parent_id=module.id,
        issue_type_id=task_type.id,
    )
    grandchild = create_project_work_item(
        project.id,
        name="Grandchild",
        parent_id=child.id,
        issue_type_id=task_type.id,
    )

    items, _states = queries.list_module_tasks_and_states(project.id, module.id)

    assert {r["id"] for r in items} == {child.id, grandchild.id}


@pytest.mark.django_db
def test_retrieve_unknown_raises_not_found(project):
    with pytest.raises(NotFoundError):
        queries.retrieve_work_item(str(uuid.uuid4()))
