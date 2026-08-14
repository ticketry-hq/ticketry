"""#624 — the directed Issue↔Issue blocker relation (blocks / blocked-by).

Exercises the additive ``blocked_by`` M2M through the package's DRF host:
the replace-set patch field, both id arrays on the work-item response, the self-block
and cycle guards, and the M2M-drop-on-delete behaviour.
"""

import uuid

import pytest

from worktracker.models import Issue, IssueType
from worktracker.tests.conftest import BASE, patch_json, post_json


def _task(client, project, auth, name):
    """Create a project task and return its JSON."""
    issue_type, _ = IssueType.objects.get_or_create(
        project=project,
        name="Task",
        defaults={"id": uuid.uuid4(), "level": "task"},
    )
    r = post_json(
        client,
        f"{BASE}/projects/{project.id}/work-items",
        {"name": name, "issue_type_id": str(issue_type.id)},
        auth,
    )
    assert r.status_code == 201
    return r.json()


@pytest.mark.django_db
def test_patch_sets_blocked_by_edge_and_both_id_arrays(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")

    r = patch_json(
        client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth
    )
    assert r.status_code == 200
    assert r.json()["blocked_by_ids"] == [b["id"]]
    assert r.json()["blocks_ids"] == []

    # The reverse edge falls out for free on B (read-only ``blocks``).
    rb = client.get(f"{BASE}/work-items/{b['id']}", headers=auth)
    assert rb.status_code == 200
    task_b = rb.json()
    assert task_b["blocks_ids"] == [a["id"]]
    assert task_b["blocked_by_ids"] == []


@pytest.mark.django_db
def test_present_empty_list_clears_blockers(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth)

    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": []}, auth)
    assert r.status_code == 200
    assert r.json()["blocked_by_ids"] == []
    assert Issue.objects.get(pk=a["id"]).blocked_by.count() == 0


@pytest.mark.django_db
def test_absent_field_leaves_blockers_untouched(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth)

    # A patch that omits blocked_by_ids must not clear the existing edge.
    r = patch_json(client, f"{BASE}/work-items/{a['id']}", {"name": "renamed"}, auth)
    assert r.status_code == 200
    assert r.json()["blocked_by_ids"] == [b["id"]]


@pytest.mark.django_db
def test_default_id_arrays_are_empty(client, project, auth):
    a = _task(client, project, auth, "A")
    assert a["blocked_by_ids"] == []
    assert a["blocks_ids"] == []


@pytest.mark.django_db
def test_self_block_is_rejected(client, project, auth):
    a = _task(client, project, auth, "A")
    r = patch_json(
        client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [a["id"]]}, auth
    )
    assert r.status_code == 422
    assert Issue.objects.get(pk=a["id"]).blocked_by.count() == 0


@pytest.mark.django_db
def test_direct_cycle_is_rejected(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    # A is blocked by B.
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth)

    # Now blocking B by A closes a 2-cycle (A↔B) — rejected, no edge written.
    r = patch_json(
        client, f"{BASE}/work-items/{b['id']}", {"blocked_by_ids": [a["id"]]}, auth
    )
    assert r.status_code == 422
    assert Issue.objects.get(pk=b["id"]).blocked_by.count() == 0


@pytest.mark.django_db
def test_transitive_cycle_is_rejected(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    c = _task(client, project, auth, "C")
    # A blocked_by B; B blocked_by C  →  C → B → A chain.
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth)
    patch_json(client, f"{BASE}/work-items/{b['id']}", {"blocked_by_ids": [c["id"]]}, auth)

    # Blocking C by A would close A → C → B → A — rejected.
    r = patch_json(
        client, f"{BASE}/work-items/{c['id']}", {"blocked_by_ids": [a["id"]]}, auth
    )
    assert r.status_code == 422


@pytest.mark.django_db
def test_deleting_a_blocker_drops_the_edge(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    patch_json(client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [b["id"]]}, auth)

    # B has no children, so the S2 delete route removes it; the M2M row goes
    # with it (not a nulled FK) and A survives with no blockers.
    r = client.delete(f"{BASE}/work-items/{b['id']}", headers=auth)
    assert r.status_code == 204

    ra = client.get(f"{BASE}/work-items/{a['id']}", headers=auth)
    assert ra.json()["blocked_by_ids"] == []
    assert Issue.objects.filter(pk=a["id"]).exists()


@pytest.mark.django_db
def test_multiple_blockers_replace_set_semantics(client, project, auth):
    a = _task(client, project, auth, "A")
    b = _task(client, project, auth, "B")
    c = _task(client, project, auth, "C")
    patch_json(
        client,
        f"{BASE}/work-items/{a['id']}",
        {"blocked_by_ids": [b["id"], c["id"]]},
        auth,
    )

    # Replace-set: patching to just [c] drops B.
    r = patch_json(
        client, f"{BASE}/work-items/{a['id']}", {"blocked_by_ids": [c["id"]]}, auth
    )
    assert r.status_code == 200
    assert r.json()["blocked_by_ids"] == [c["id"]]
