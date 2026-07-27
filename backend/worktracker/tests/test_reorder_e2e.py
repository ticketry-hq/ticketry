"""End-to-end within-column reorder over real HTTP (#626).

Runs against pytest-django's ``live_server`` — a real WSGI server with the full
migration set applied (so ``rank`` exists and 0006's backfill ran), exercising
the actual ``POST /work-items/{id}/reorder`` route, JSON serialization, and
``order_by`` exactly as the studio frontend hits them. Each "reload" is a fresh
GET, so a passing run proves the order *persists* server-side, not just in a
single request.
"""

import httpx
import pytest

from worktracker.tests.conftest import BASE, TOKEN


def _api(live_server):
    return httpx.Client(
        base_url=f"{live_server.url}{BASE}",
        headers={"x-api-key": TOKEN, "Content-Type": "application/json"},
    )


def _create(client, project_id, name):
    r = client.post(f"/projects/{project_id}/work-items", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def _list_ids(client, project_id):
    """A fresh GET — the 'reload' — returning ids in server (rank) order."""
    r = client.get(f"/projects/{project_id}/work-items")
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()]


def _reorder(client, item_id, before=None, after=None):
    return client.post(
        f"/work-items/{item_id}/reorder",
        json={"before_id": before, "after_id": after},
    )


@pytest.mark.django_db(transaction=True)
def test_within_column_reorder_persists_over_http(live_server, project):
    with _api(live_server) as client:
        a = _create(client, project.id, "A")
        b = _create(client, project.id, "B")
        c = _create(client, project.id, "C")

        # Creation order is the baseline (each create appends to the tail).
        assert _list_ids(client, project.id) == [a["id"], b["id"], c["id"]]
        assert all(i["rank"] for i in (a, b, c))

        # Drag C to the very top (above A) and reload.
        r = _reorder(client, c["id"], before=None, after=a["id"])
        assert r.status_code == 200, r.text
        assert _list_ids(client, project.id) == [c["id"], a["id"], b["id"]]

        # Drag A to the bottom (below B) and reload — order still persists.
        r = _reorder(client, a["id"], before=b["id"], after=None)
        assert r.status_code == 200, r.text
        assert _list_ids(client, project.id) == [c["id"], b["id"], a["id"]]

        # Drag B between C and A (the current top two) and reload.
        r = _reorder(client, b["id"], before=c["id"], after=a["id"])
        assert r.status_code == 200, r.text
        assert _list_ids(client, project.id) == [c["id"], b["id"], a["id"]]

        # Only the moved row ever changed rank: neighbors keep their keys.
        final = {i["id"]: i["rank"] for i in client.get(
            f"/projects/{project.id}/work-items"
        ).json()}
        assert final[c["id"]] < final[b["id"]] < final[a["id"]]


@pytest.mark.django_db(transaction=True)
def test_dense_reinserts_persist_over_http(live_server, project):
    with _api(live_server) as client:
        lo = _create(client, project.id, "lo")
        hi = _create(client, project.id, "hi")
        mover = _create(client, project.id, "mover")

        # Repeatedly drop `mover` between the same two neighbors; every reload
        # keeps a valid, strictly-ordered column (the string space never runs out).
        for _ in range(25):
            r = _reorder(client, mover["id"], before=lo["id"], after=hi["id"])
            assert r.status_code == 200, r.text
            ids = _list_ids(client, project.id)
            assert ids == [lo["id"], mover["id"], hi["id"]]


@pytest.mark.django_db(transaction=True)
def test_inverted_neighbors_rejected_over_http(live_server, project):
    with _api(live_server) as client:
        a = _create(client, project.id, "A")
        b = _create(client, project.id, "B")
        c = _create(client, project.id, "C")
        # a.rank < b.rank; before=b, after=a is inverted → 422, order unchanged.
        r = _reorder(client, c["id"], before=b["id"], after=a["id"])
        assert r.status_code == 422, r.text
        assert _list_ids(client, project.id) == [a["id"], b["id"], c["id"]]
