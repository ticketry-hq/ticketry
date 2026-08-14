"""The dedicated review-finding create — service + HTTP surface (#905).

A review finding is a direct Implementation child, born in the Implementation
workflow's start stage, under a Story that is currently in ``Review``. Creation
is validated *before any write*: a parent that is not a Story, not in
``Review``, or in a foreign project is rejected with the workflow gate's structured 422 body
(``detail``/``code``/``from``/``to``). Creation is inert — it never moves the
parent or draws an edge.
"""

import uuid

import pytest

from apps.runs.models import AutomationAttempt
from worktracker.models import DEFAULT_STATES, Issue, IssueType, Project, State
from worktracker.sequences import allocate_sequence_id
from worktracker.services.work_items import create_review_finding
from worktracker.tests.conftest import BASE, post_json
from worktracker.workflow import InvalidTransition


@pytest.fixture
def sdlc(project):
    """Seed the canonical states + Story/Implementation types."""

    states = {
        name: State.objects.create(
            id=uuid.uuid4(), project=project, name=name, group=group
        )
        for name, group, _color in DEFAULT_STATES
    }
    types = {
        "Story": IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Story",
            level="task",
            start_state=states["Grill"],
            workflow_revision=1,
        ),
        "Implementation": IssueType.objects.create(
            id=uuid.uuid4(),
            project=project,
            name="Implementation",
            level="task",
            start_state=states["Implement"],
            workflow_revision=1,
        ),
    }
    return states, types


def _story(project, states, types, *, state, issue_type="Story"):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=types[issue_type],
        name="Parent",
        sequence_id=allocate_sequence_id(project.id),
        state=states[state],
    )


# --- service: happy path ----------------------------------------------------


@pytest.mark.django_db
def test_create_review_finding_births_implementation_at_start_stage(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    finding = create_review_finding(
        project.id,
        parent_id=parent.id,
        name="Null deref in loader",
        description="Path: src/loader.py\nLines: 10-12",
    )

    assert finding.parent_id == parent.id
    assert "Ready" not in states
    assert finding.state_id == states["Implement"].id
    assert finding.issue_type_id == types["Implementation"].id
    assert finding.description == "Path: src/loader.py\nLines: 10-12"


@pytest.mark.django_db
def test_create_review_finding_leaves_parent_untouched(project, sdlc):
    """Creation is inert: the parent stays in Review and no edge is drawn."""

    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    finding = create_review_finding(
        project.id, parent_id=parent.id, name="F", description="Path: a.py\nLines: 1-1"
    )

    parent.refresh_from_db()
    assert parent.state_id == states["Review"].id
    assert list(parent.blocked_by.all()) == []
    assert list(finding.blocked_by.all()) == []
    assert not AutomationAttempt.objects.filter(issue=finding).exists()


# --- service: rejections ----------------------------------------------------


@pytest.mark.django_db
def test_reject_parent_not_story(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review", issue_type="Implementation")

    with pytest.raises(InvalidTransition) as excinfo:
        create_review_finding(
            project.id, parent_id=parent.id, name="F", description="d"
        )

    assert excinfo.value.code == "parent_not_story"
    assert not Issue.objects.filter(parent_id=parent.id).exists()


@pytest.mark.django_db
def test_reject_parent_not_in_review(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Implement")

    with pytest.raises(InvalidTransition) as excinfo:
        create_review_finding(
            project.id, parent_id=parent.id, name="F", description="d"
        )

    assert excinfo.value.code == "parent_not_review"
    assert excinfo.value.from_state == "Implement"
    assert not Issue.objects.filter(parent_id=parent.id).exists()


@pytest.mark.django_db
def test_reject_foreign_project_parent(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")
    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="Other", slug="OTHR"
    )

    with pytest.raises(InvalidTransition) as excinfo:
        create_review_finding(other.id, parent_id=parent.id, name="F", description="d")

    assert excinfo.value.code == "foreign_project"


# --- HTTP surface -----------------------------------------------------------


@pytest.mark.django_db
def test_http_work_item_create_absorbs_review_finding(client, project, sdlc, auth):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {
            "parent_id": str(parent.id),
            "name": "Finding",
            "description": "Path: a.py\nLines: 1-1",
        },
        auth,
    )

    assert r.status_code == 201
    body = r.json()
    assert body["state"] == str(states["Implement"].id)
    assert body["issue_type"] == str(types["Implementation"].id)


@pytest.mark.django_db
def test_http_absorbed_finding_illegal_parent_returns_structured_422(
    client, project, sdlc, auth
):
    states, types = sdlc
    parent = _story(project, states, types, state="Grill")

    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"parent_id": str(parent.id), "name": "F", "description": "d"},
        auth,
    )

    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "parent_not_review"
    assert body["from"] == "Grill"
    assert set(body) >= {"detail", "code", "from", "to"}
