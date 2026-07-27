"""Impact-aware shared workflow-state replacement (CODIN-1126)."""

import uuid

import pytest

from worktracker.models import (
    ForceTransition,
    Issue,
    IssueType,
    IssueTypeTransition,
    State,
)
from worktracker.services import workflow_config as svc
from worktracker.services.errors import ServiceError
from worktracker.tests.conftest import BASE


def _state(project, name, group="started", **kwargs):
    return State.objects.create(
        id=uuid.uuid4(), project=project, name=name, group=group, **kwargs
    )


def _issue(project, state, issue_type, sequence_id):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=issue_type,
        name=f"Issue {sequence_id}",
        sequence_id=sequence_id,
        state=state,
    )


@pytest.mark.django_db
def test_state_impact_reports_items_workflows_protection_and_replacements(project):
    source = _state(project, "Doing", is_protected=True)
    replacement = _state(project, "Review")
    other_group = _state(project, "Done", group="completed")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=source,
        workflow_revision=7,
    )
    _issue(project, source, issue_type, 1)
    _issue(project, source, None, 2)
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=source,
        to_state=other_group,
    )

    impact = svc.get_state_impact(source.id)

    assert impact["state_id"] == source.id
    assert impact["total_work_items"] == 2
    assert impact["work_item_counts"] == [
        {"issue_type_id": None, "issue_type_name": None, "count": 1},
        {
            "issue_type_id": issue_type.id,
            "issue_type_name": "Feature",
            "count": 1,
        },
    ]
    assert impact["workflow_references"] == [
        {
            "issue_type_id": issue_type.id,
            "issue_type_name": "Feature",
            "revision": 7,
            "roles": ["start", "edge_source"],
        }
    ]
    assert impact["protection_rules"] == [
        {
            "code": "protected_state",
            "message": "Protected workflow states cannot be deleted.",
        },
        {
            "code": "replacement_required",
            "message": "Occupied or workflow-referenced states require an explicit replacement.",
        },
    ]
    assert [item.id for item in impact["valid_replacements"]] == [
        replacement.id,
        other_group.id,
    ]
    assert len(impact["impact_token"]) == 64


@pytest.mark.django_db
def test_bare_delete_of_workflow_referenced_state_is_rejected_without_mutation(project):
    source = _state(project, "Doing")
    replacement = _state(project, "Review")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=source,
        workflow_revision=3,
    )
    transition = IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=source,
        to_state=replacement,
    )

    with pytest.raises(ServiceError) as exc:
        svc.delete_state(source.id)

    assert exc.value.status_code == 409
    assert State.objects.filter(pk=source.id).exists()
    issue_type.refresh_from_db()
    assert issue_type.workflow_revision == 3
    assert IssueTypeTransition.objects.filter(pk=transition.pk).exists()


@pytest.mark.django_db
def test_confirmed_replacement_moves_items_and_repairs_workflow_graphs(project):
    source = _state(project, "Doing")
    replacement = _state(project, "Review")
    done = _state(project, "Done", group="completed")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=source,
        workflow_revision=4,
    )
    issue = _issue(project, source, issue_type, 1)
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=source,
        to_state=replacement,
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=replacement,
        to_state=done,
    )
    impact = svc.get_state_impact(source.id)

    svc.delete_state(
        source.id,
        reassign_to=replacement.id,
        impact_token=impact["impact_token"],
    )

    issue.refresh_from_db()
    issue_type.refresh_from_db()
    assert issue.state_id == replacement.id
    assert ForceTransition.objects.get(issue=issue).actor == "state-deletion"
    assert not State.objects.filter(pk=source.id).exists()
    assert issue_type.workflow_revision == 5
    assert issue_type.start_state_id == replacement.id
    assert set(
        IssueTypeTransition.objects.filter(issue_type=issue_type).values_list(
            "from_state_id", "to_state_id"
        )
    ) == {(replacement.id, done.id)}


@pytest.mark.django_db
def test_changed_impact_confirmation_conflicts_without_applying(project):
    source = _state(project, "Doing")
    replacement = _state(project, "Review")
    feature = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Feature", level="task"
    )
    defect = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Defect", level="task"
    )
    issue = _issue(project, source, feature, 1)
    impact = svc.get_state_impact(source.id)

    issue.issue_type = defect
    issue.save(update_fields=["issue_type", "updated_at"])

    with pytest.raises(ServiceError) as exc:
        svc.delete_state(
            source.id,
            reassign_to=replacement.id,
            impact_token=impact["impact_token"],
        )

    assert exc.value.status_code == 409
    assert "impact changed" in exc.value.message.lower()
    issue.refresh_from_db()
    assert issue.state_id == source.id
    assert State.objects.filter(pk=source.id).exists()
    assert not ForceTransition.objects.filter(issue=issue).exists()


@pytest.mark.django_db
def test_state_impact_is_exposed_as_a_typed_http_contract(client, project, auth):
    source = _state(project, "Doing")
    replacement = _state(project, "Review")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(), project=project, name="Feature", level="task"
    )
    _issue(project, source, issue_type, 1)

    response = client.get(f"{BASE}/states/{source.id}/impact", headers=auth)

    assert response.status_code == 200
    body = response.json()
    assert body["state_id"] == str(source.id)
    assert body["total_work_items"] == 1
    assert body["work_item_counts"] == [
        {
            "issue_type_id": str(issue_type.id),
            "issue_type_name": "Feature",
            "count": 1,
        }
    ]
    assert body["workflow_references"] == []
    assert body["protection_rules"][0]["code"] == "replacement_required"
    assert [item["id"] for item in body["valid_replacements"]] == [
        str(replacement.id)
    ]


@pytest.mark.django_db
def test_replacement_allows_standing_workflow_warnings(project):
    source = _state(project, "Doing")
    replacement = _state(project, "Review")
    _state(project, "Done", group="completed")
    issue_type = IssueType.objects.create(
        id=uuid.uuid4(),
        project=project,
        name="Feature",
        level="task",
        start_state=source,
        workflow_revision=2,
    )
    issue = _issue(project, source, issue_type, 1)
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=source,
        to_state=replacement,
    )
    impact = svc.get_state_impact(source.id)

    svc.delete_state(
        source.id,
        reassign_to=replacement.id,
        impact_token=impact["impact_token"],
    )

    issue.refresh_from_db()
    issue_type.refresh_from_db()
    assert issue.state_id == replacement.id
    assert not State.objects.filter(pk=source.id).exists()
    assert issue_type.workflow_revision == 3
    assert ForceTransition.objects.filter(issue=issue).exists()


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
    issue = _issue(project, first, issue_type, 1)
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=first,
        to_state=second,
    )
    IssueTypeTransition.objects.create(
        issue_type=issue_type,
        from_state=second,
        to_state=done,
    )

    svc.reorder_states(project.id, [done.id, second.id, first.id])

    issue.refresh_from_db()
    issue_type.refresh_from_db()
    assert issue.state_id == first.id
    assert issue_type.workflow_revision == 6
    assert set(
        IssueTypeTransition.objects.filter(issue_type=issue_type).values_list(
            "from_state_id", "to_state_id"
        )
    ) == {(first.id, second.id), (second.id, done.id)}
