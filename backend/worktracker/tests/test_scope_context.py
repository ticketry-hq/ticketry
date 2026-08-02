"""#667 (B) — the read-only agent scope-context payload.

Exercises ``GET /work-items/{id}/scope-context``: direct ``depends_on`` /
``depended_by`` edge sets, ``resolved`` state-group reflection, a non-empty
advisory when unresolved blockers exist, the 404 on a missing id, and a bounded
query count.
"""

import uuid

import pytest
from django.test.utils import CaptureQueriesContext
from django.db import connection

from worktracker.models import IssueType, State
from worktracker.tests.conftest import BASE, patch_json, post_json


def _task(client, project, auth, name):
    """Create a project task and return its JSON."""
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Story",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": name, "issue_type_id": str(issue_type.id)},
        auth,
    )
    assert r.status_code == 200
    return r.json()


def _block(client, issue_id, blocker_ids, auth):
    """Set ``issue_id``'s blockers to ``blocker_ids`` (replace-set)."""
    r = patch_json(
        client, f"{BASE}/work-items/{issue_id}", {"blocked_by_ids": blocker_ids}, auth
    )
    assert r.status_code == 200


def _scope(client, issue_id, auth):
    """GET the scope-context payload, asserting 200."""
    r = client.get(f"{BASE}/work-items/{issue_id}/scope-context", headers=auth)
    assert r.status_code == 200
    return r.json()


@pytest.mark.django_db
def test_depends_on_and_depended_by_are_direct_edge_sets(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    c = _task(client, project, auth, "C")
    # A blocked_by B  →  B depends-on nothing, A depends_on B, B depended_by A.
    _block(client, a["id"], [b["id"]], auth)
    # C blocked_by A  →  A depended_by C.
    _block(client, c["id"], [a["id"]], auth)

    payload = _scope(client, a["id"], auth)

    assert payload["task"]["key"] == a["key"]
    assert [d["key"] for d in payload["depends_on"]] == [b["key"]]
    assert [d["key"] for d in payload["depended_by"]] == [c["key"]]


@pytest.mark.django_db
def test_resolved_reflects_state_group(client, project, auth):
    done = State.objects.create(
        id=uuid.uuid4(), project=project, name="Done", group="completed"
    )
    todo = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    a = _task(client, project, auth, "A")
    resolved_blocker = _task(client, project, auth, "B")
    open_blocker = _task(client, project, auth, "C")
    patch_json(client, f"{BASE}/work-items/{resolved_blocker['id']}", {"state_id": str(done.id)}, auth)
    patch_json(client, f"{BASE}/work-items/{open_blocker['id']}", {"state_id": str(todo.id)}, auth)
    _block(client, a["id"], [resolved_blocker["id"], open_blocker["id"]], auth)

    payload = _scope(client, a["id"], auth)
    by_key = {d["key"]: d for d in payload["depends_on"]}

    assert by_key[resolved_blocker["key"]]["state_group"] == "completed"
    assert by_key[resolved_blocker["key"]]["resolved"] is True
    assert by_key[open_blocker["key"]]["state_group"] == "unstarted"
    assert by_key[open_blocker["key"]]["resolved"] is False


@pytest.mark.django_db
def test_advisory_non_empty_when_unresolved_blocker_exists(client, project, auth):
    todo = State.objects.create(
        id=uuid.uuid4(), project=project, name="Todo", group="unstarted"
    )
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    patch_json(client, f"{BASE}/work-items/{b['id']}", {"state_id": str(todo.id)}, auth)
    _block(client, a["id"], [b["id"]], auth)

    payload = _scope(client, a["id"], auth)

    assert payload["advisory"]
    assert b["key"] in payload["advisory"]


@pytest.mark.django_db
def test_advisory_present_without_blockers(client, project, auth):
    a = _task(client, project, auth, "A")
    payload = _scope(client, a["id"], auth)

    assert payload["depends_on"] == []
    # Always a usable string, even with a clean slate.
    assert payload["advisory"]


@pytest.mark.django_db
def test_resolves_by_key(client, project, auth):
    a = _task(client, project, auth, "A")
    payload = _scope(client, a["key"], auth)
    assert payload["task"]["id"] == a["id"]


@pytest.mark.django_db
def test_404_on_missing_id(client, auth):
    r = client.get(
        f"{BASE}/work-items/{uuid.uuid4()}/scope-context", headers=auth
    )
    assert r.status_code == 404


@pytest.mark.django_db
def test_query_count_is_bounded_by_prefetch(client, project, auth):
    a = _task(client, project, auth, "A")
    # Five blockers + five dependents — the query count must not scale with them.
    blockers = [_task(client, project, auth, f"b-{i}")["id"] for i in range(5)]
    _block(client, a["id"], blockers, auth)
    for i in range(5):
        dep = _task(client, project, auth, f"down-{i}")
        _block(client, dep["id"], [a["id"]], auth)

    with CaptureQueriesContext(connection) as ctx:
        r = client.get(f"{BASE}/work-items/{a['id']}/scope-context", headers=auth)
        assert r.status_code == 200

    # Resolve + two prefetched edge sets; a handful, never one-per-neighbor.
    # Generous ceiling guards the prefetch.
    assert len(ctx.captured_queries) <= 10
