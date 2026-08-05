"""Within-column reorder route + rank ordering (#626)."""

import uuid

import pytest

from worktracker.models import IssueType
from worktracker.tests.conftest import BASE, post_json


def _make(client, project, auth, name):
    """Create a project task and return its JSON (carrying id + rank)."""
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    return post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": name, "issue_type_id": str(issue_type.id)},
        auth,
    ).json()


def _reorder(client, auth, item_id, before=None, after=None):
    return post_json(
        client,
        f"{BASE}/work-items/{item_id}/reorder",
        {"before_id": before, "after_id": after},
        auth,
    )


@pytest.mark.django_db
def test_create_assigns_a_rank(client, project, auth):
    item = _make(client, project, auth, "A")
    assert item["rank"]


@pytest.mark.django_db
def test_creates_get_increasing_ranks(client, project, auth):
    a = _make(client, project, auth, "A")
    b = _make(client, project, auth, "B")
    c = _make(client, project, auth, "C")
    assert a["rank"] < b["rank"] < c["rank"]


@pytest.mark.django_db
def test_list_is_ordered_by_rank(client, project, auth):
    a = _make(client, project, auth, "A")
    b = _make(client, project, auth, "B")
    c = _make(client, project, auth, "C")
    # Move C to the very top (above A).
    _reorder(client, auth, c["id"], before=None, after=a["id"])

    listed = client.get(f"{BASE}/work-items?project={project.id}", headers=auth).json()
    assert [i["id"] for i in listed] == [c["id"], a["id"], b["id"]]


@pytest.mark.django_db
def test_reorder_writes_only_the_moved_row(client, project, auth):
    a = _make(client, project, auth, "A")
    b = _make(client, project, auth, "B")
    c = _make(client, project, auth, "C")

    # Move A between B and C — only A's rank should change.
    r = _reorder(client, auth, a["id"], before=b["id"], after=c["id"])
    assert r.status_code == 200
    moved = r.json()
    assert b["rank"] < moved["rank"] < c["rank"]

    # B and C are untouched.
    after = {
        i["id"]: i["rank"]
        for i in client.get(
            f"{BASE}/work-items?project={project.id}", headers=auth
        ).json()
    }
    assert after[b["id"]] == b["rank"]
    assert after[c["id"]] == c["rank"]


@pytest.mark.django_db
def test_reorder_to_top_and_bottom(client, project, auth):
    a = _make(client, project, auth, "A")
    b = _make(client, project, auth, "B")

    top = _reorder(client, auth, b["id"], before=None, after=a["id"]).json()
    assert top["rank"] < a["rank"]

    bottom = _reorder(client, auth, top["id"], before=a["id"], after=None).json()
    assert bottom["rank"] > a["rank"]


@pytest.mark.django_db
def test_reorder_into_empty_column_is_valid(client, project, auth):
    a = _make(client, project, auth, "A")
    r = _reorder(client, auth, a["id"], before=None, after=None)
    assert r.status_code == 200
    assert r.json()["rank"]


@pytest.mark.django_db
def test_dense_inserts_at_one_spot_all_succeed(client, project, auth):
    """Repeated reorders between the same two neighbors keep succeeding and
    stay strictly between them — the string space never runs out."""

    lo = _make(client, project, auth, "lo")
    hi = _make(client, project, auth, "hi")
    mover = _make(client, project, auth, "mover")

    for _ in range(40):
        r = _reorder(client, auth, mover["id"], before=lo["id"], after=hi["id"])
        assert r.status_code == 200
        assert lo["rank"] < r.json()["rank"] < hi["rank"]


@pytest.mark.django_db
def test_inverted_neighbors_rejected(client, project, auth):
    """A drop whose before-rank is not below its after-rank is rejected (422)."""

    a = _make(client, project, auth, "A")
    b = _make(client, project, auth, "B")
    c = _make(client, project, auth, "C")
    # a.rank < b.rank by creation order; passing before=b, after=a is inverted.
    r = _reorder(client, auth, c["id"], before=b["id"], after=a["id"])
    assert r.status_code == 422


@pytest.mark.django_db
def test_neighbor_from_another_project_rejected(client, project, auth):
    from worktracker.models import Project

    a = _make(client, project, auth, "A")
    other = Project.objects.create(
        id=uuid.uuid4(), workspace=project.workspace, name="other", slug="OTHER"
    )
    foreign_type = IssueType.objects.create(
        id=uuid.uuid4(), project=other, name="Task", level="task"
    )
    foreign = post_json(
        client,
        f"{BASE}/projects/{other.id}/work-items",
        {"name": "F", "issue_type_id": str(foreign_type.id)},
        auth,
    ).json()

    r = _reorder(client, auth, a["id"], before=foreign["id"], after=None)
    assert r.status_code == 422
