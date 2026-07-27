"""The dedicated review-finding create — service + HTTP surface (#905).

A review finding is a direct Implementation child, born in ``Ready`` (its real
birth state, not the ``Idea`` default a generic create would land it in), under
a Story that is currently in ``Review``. Creation is validated *before any
write*: a parent that is not a Story, not in ``Review``, in a foreign project,
or a non-Implementation type override is rejected with the workflow gate's
structured 422 body (``detail``/``code``/``from``/``to``). Creation is inert —
it never moves the parent or draws an edge.
"""

import json
import uuid

import pytest

from worktracker.models import DEFAULT_STATES, Issue, IssueType, Project, State, Workspace
from worktracker.services.errors import ValidationError
from worktracker.sequences import allocate_sequence_id
from worktracker.services.work_items import create_review_finding
from worktracker.tests.conftest import BASE, post_json
from worktracker.workflow import InvalidTransition


@pytest.fixture
def sdlc(project):
    """Seed the seven canonical states + Story/Implementation types."""

    states = {
        name: State.objects.create(
            id=uuid.uuid4(), project=project, name=name, group=group
        )
        for name, group, _color in DEFAULT_STATES
    }
    types = {
        name: IssueType.objects.create(
            id=uuid.uuid4(), project=project, name=name, level="task"
        )
        for name in ("Story", "Implementation")
    }
    return states, types


def _story(project, states, types, *, state, issue_type="Story"):
    return Issue.objects.create(
        id=uuid.uuid4(),
        project=project,
        type="task",
        issue_type=types[issue_type] if issue_type else None,
        name="Parent",
        sequence_id=allocate_sequence_id(project.id),
        state=states[state],
    )


# --- service: happy path ----------------------------------------------------


@pytest.mark.django_db
def test_create_review_finding_births_ready_implementation(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    finding = create_review_finding(
        project.id,
        parent_id=parent.id,
        name="Null deref in loader",
        description="Path: src/loader.py\nLines: 10-12",
    )

    assert finding.parent_id == parent.id
    assert finding.state_id == states["Ready"].id
    assert finding.issue_type_id == types["Implementation"].id
    # #775: readers surface description_html, so the evidence block must land there.
    assert finding.description_html == "Path: src/loader.py\nLines: 10-12"


@pytest.mark.django_db
def test_create_review_finding_leaves_parent_untouched(project, sdlc):
    """Creation is inert: the parent Story stays in Review, no edge drawn."""

    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    create_review_finding(
        project.id, parent_id=parent.id, name="F", description="Path: a.py\nLines: 1-1"
    )

    parent.refresh_from_db()
    assert parent.state_id == states["Review"].id
    assert list(parent.blocked_by.all()) == []


@pytest.mark.django_db
def test_create_review_finding_accepts_explicit_implementation_type(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    finding = create_review_finding(
        project.id,
        parent_id=parent.id,
        name="F",
        description="Path: a.py\nLines: 1-1",
        issue_type_id=types["Implementation"].id,
    )

    assert finding.issue_type_id == types["Implementation"].id


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
        create_review_finding(
            other.id, parent_id=parent.id, name="F", description="d"
        )

    assert excinfo.value.code == "foreign_project"


@pytest.mark.django_db
def test_reject_non_implementation_type_override(project, sdlc):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    with pytest.raises(InvalidTransition) as excinfo:
        create_review_finding(
            project.id,
            parent_id=parent.id,
            name="F",
            description="d",
            issue_type_id=types["Story"].id,
        )

    assert excinfo.value.code == "child_not_implementation"
    assert not Issue.objects.filter(parent_id=parent.id).exists()


@pytest.mark.django_db
def test_reject_missing_ready_state(project, sdlc):
    states, types = sdlc
    states["Ready"].delete()
    parent = _story(project, states, types, state="Review")

    with pytest.raises(ValidationError):
        create_review_finding(
            project.id, parent_id=parent.id, name="F", description="d"
        )


# --- HTTP surface -----------------------------------------------------------


@pytest.mark.django_db
def test_http_create_review_finding_returns_200(client, project, sdlc, auth):
    states, types = sdlc
    parent = _story(project, states, types, state="Review")

    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/review-findings",
        {
            "parent_id": str(parent.id),
            "name": "Finding",
            "description": "Path: a.py\nLines: 1-1",
        },
        auth,
    )

    assert r.status_code == 200
    body = r.json()
    assert body["state"]["name"] == "Ready"
    assert body["issue_type"]["name"] == "Implementation"


@pytest.mark.django_db
def test_http_create_review_finding_illegal_parent_returns_structured_422(
    client, project, sdlc, auth
):
    states, types = sdlc
    parent = _story(project, states, types, state="Idea")

    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/review-findings",
        {"parent_id": str(parent.id), "name": "F", "description": "d"},
        auth,
    )

    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "parent_not_review"
    assert body["from"] == "Idea"
    assert set(body) >= {"detail", "code", "from", "to"}
