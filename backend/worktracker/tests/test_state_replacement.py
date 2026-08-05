"""CODING-158: guarded bare state deletion and retained workflow pruning."""

import json
import inspect
import uuid

import pytest

from worktracker.models import (
    Issue,
    IssueType,
    IssueTypeTransition,
    LaunchBinding,
    State,
)
from worktracker.services import scoped_workflows, workflow_config
from worktracker.tests.conftest import BASE


def _state(project, name, group="started", **kwargs):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name=name, group=group, **kwargs
    )


def _issue(project, state, issue_type, sequence_id=1):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name=f"Issue {sequence_id}",
        sequence_id=sequence_id,
        state=state,
    )


def test_preview_token_and_reassignment_service_surface_is_removed():
    assert not hasattr(workflow_config, "get_state_impact")
    assert not hasattr(scoped_workflows, "preview_impact")
    assert tuple(inspect.signature(workflow_config.delete_state).parameters) == (
        "state_id",
    )


@pytest.mark.django_db
def test_occupied_state_delete_returns_named_conflict_without_mutation(
    client, project, auth
):
    source = _state(project, "Doing")
    _state(project, "Review")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Feature", level="task"
    )
    issue = _issue(project, source, issue_type)

    response = client.delete(f"{BASE}/states/{source.id}", headers=auth)

    assert response.status_code == 409
    assert "occupied" in response.json()["detail"].lower()
    issue.refresh_from_db()
    assert issue.state_id == source.id
    assert State.objects.filter(pk=source.id).exists()


@pytest.mark.django_db
def test_empty_unreferenced_state_delete_succeeds(client, project, auth):
    source = _state(project, "Doing")
    sibling = _state(project, "Review")

    response = client.delete(f"{BASE}/states/{source.id}", headers=auth)

    assert response.status_code == 204
    assert not State.objects.filter(pk=source.id).exists()
    assert State.objects.filter(pk=sibling.id).exists()


@pytest.mark.django_db
def test_workflow_referenced_state_delete_returns_conflict_without_pruning(
    client, project, auth
):
    source = _state(project, "Doing")
    target = _state(project, "Review")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=source,
        workflow_revision=3,
    )
    transition = IssueTypeTransition.objects.create(
        issue_type=issue_type, from_state=source, to_state=target
    )

    response = client.delete(f"{BASE}/states/{source.id}", headers=auth)

    assert response.status_code == 409
    assert "workflow configuration" in response.json()["detail"].lower()
    issue_type.refresh_from_db()
    assert issue_type.start_state_id == source.id
    assert issue_type.workflow_revision == 3
    assert IssueTypeTransition.objects.filter(pk=transition.pk).exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "path"),
    (
        ("get", "/states/{state_id}/impact"),
        ("post", "/issue-types/{type_id}/workflow-settings/impact"),
    ),
)
def test_deleted_impact_routes_do_not_resolve(client, method, path):
    concrete = path.format(state_id=uuid.uuid4(), type_id=uuid.uuid4())
    if method == "get":
        response = client.get(f"{BASE}{concrete}")
    else:
        response = client.post(
            f"{BASE}{concrete}",
            data=json.dumps({"operation": "remove_state", "workflow_revision": 0}),
            content_type="application/json",
        )

    assert response.status_code == 404


@pytest.mark.django_db
def test_transition_edit_still_prunes_unreachable_rows(project):
    start = _state(project, "Todo", group="unstarted")
    middle = _state(project, "Doing")
    done = _state(project, "Done", group="completed")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=start,
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type, from_state=start, to_state=middle
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type, from_state=middle, to_state=done
    )
    binding = LaunchBinding.objects.create(
        issue_type=issue_type, state=middle, prompt="Implement"
    )

    scoped_workflows.remove_transition(
        issue_type.id, start.id, middle.id, workflow_revision=0
    )

    assert not IssueTypeTransition.objects.filter(issue_type=issue_type).exists()
    assert not LaunchBinding.objects.filter(pk=binding.pk).exists()
    issue_type.refresh_from_db()
    assert issue_type.workflow_revision == 1


@pytest.mark.django_db
def test_display_reorder_changes_neither_item_states_nor_workflow_edges(project):
    first = _state(project, "Doing")
    second = _state(project, "Review")
    done = _state(project, "Done", group="completed")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=first,
        workflow_revision=6,
    )
    issue = _issue(project, first, issue_type)
    IssueTypeTransition.objects.create(
        issue_type=issue_type, from_state=first, to_state=second
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type, from_state=second, to_state=done
    )

    workflow_config.reorder_states(project.id, [done.id, second.id, first.id])

    issue.refresh_from_db()
    issue_type.refresh_from_db()
    assert issue.state_id == first.id
    assert issue_type.workflow_revision == 6
    assert set(
        IssueTypeTransition.objects.filter(issue_type=issue_type).values_list(
            "from_state_id", "to_state_id"
        )
    ) == {(first.id, second.id), (second.id, done.id)}
